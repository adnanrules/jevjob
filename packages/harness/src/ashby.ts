import { createHash } from "node:crypto";
import { canonicalUrl, plainText, type ParsedPosting } from "./posting";

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
export type JsonReader = (url: string) => Promise<unknown>;

/** A per-search cache shares one public API request across a discovered employer's postings. No saved employers. */
export function ashbyReader(read: JsonReader = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
  if (!response.ok) throw new Error(`Ashby public feed HTTP ${response.status}`);
  return response.json();
}) {
  const boards = new Map<string, Promise<unknown>>();
  return async (value: string, now = Date.now()): Promise<ParsedPosting | null> => {
    const url = new URL(value);
    if (url.hostname !== "jobs.ashbyhq.com") return null;
    const [, board, id] = url.pathname.split("/");
    if (!board || !id || !/^[a-z\d_-]+$/i.test(board)) return null;
    if (!boards.has(board)) boards.set(board, read(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`));
    const data = obj(await boards.get(board));
    if (!Array.isArray(data.jobs)) throw new Error("Invalid Ashby public feed");
    const row = data.jobs.map(obj).find((j) => {
      try { return new URL(str(j.jobUrl)).pathname.split("/")[2] === id; } catch { return false; }
    });
    if (!row || row.isListed === false) return { reason: "posting no longer listed on employer board" };
    const title = str(row.title), description = plainText(str(row.descriptionHtml) || str(row.descriptionPlain));
    const postedAt = str(row.publishedAt);
    if (!title || description.length < 200) return { reason: "incomplete employer feed record" };
    if (!Number.isFinite(Date.parse(postedAt)) || Date.parse(postedAt) > now) return { reason: "invalid employer publication date" };
    const address = obj(obj(row.address).postalAddress);
    const secondary = Array.isArray(row.secondaryLocations) ? row.secondaryLocations.map((p) => str(obj(p).location)) : [];
    const remote = row.workplaceType === "Remote" || !row.workplaceType && row.isRemote === true;
    const location = [...new Set([remote ? "Remote" : str(row.workplaceType), str(row.location), str(address.addressCountry), ...secondary].filter(Boolean))].join("; ");
    const postingUrl = canonicalUrl(str(row.jobUrl));
    const applyUrl = canonicalUrl(str(row.applyUrl) || postingUrl);
    if (new URL(postingUrl).hostname !== "jobs.ashbyhq.com" || new URL(applyUrl).hostname !== "jobs.ashbyhq.com") return { reason: "unexpected employer application host" };
    return { method: "ats-api", job: { id: `web:${createHash("sha256").update(postingUrl).digest("hex").slice(0, 24)}`, company: board, title, description, location, postedAt, postingUrl, applyUrl } };
  };
}
