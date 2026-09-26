import { createHash } from "node:crypto";
import type { RawJob } from "@jevjob/core";
import { publicUrl } from "./public-page";

export interface WebResult { url: string; title?: string; text?: string; publishedDate?: string }
export type ParsedPosting = { job: RawJob; method: "jobposting" | "page-text" | "ats-api" } | { reason: string };
const string = (v: unknown): string => typeof v === "string" ? v.trim() : "";
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : v ? [v] : [];

export function plainText(html: string): string {
  const decode = (value: string) => value
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_, x: string) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " })[x.toLowerCase()]!)
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
      const code = n[0]?.toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
  return decode(decode(html)).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}

export function canonicalUrl(value: string): string {
  const url = publicUrl(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$|trk$|trackingId$|refId$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url.href;
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(records);
  const row = object(value);
  return [...(list(row["@type"]).includes("JobPosting") ? [row] : []), ...list(row["@graph"]).flatMap(records), ...list(row.mainEntity).flatMap(records)];
}

function date(value: unknown): string | undefined {
  const raw = string(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw) || !Number.isFinite(Date.parse(raw))) return undefined;
  if (new Date(`${raw.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== raw.slice(0, 10)) return undefined;
  return raw;
}

function location(row: Record<string, unknown>): string {
  const places = list(row.jobLocation).map((p) => {
    const address = object(object(p).address);
    return [address.addressLocality, address.addressRegion, typeof address.addressCountry === "string" ? address.addressCountry : object(address.addressCountry).name].map(string).filter(Boolean).join(", ");
  }).filter(Boolean);
  if (/TELECOMMUTE/i.test(string(row.jobLocationType))) {
    const areas = list(row.applicantLocationRequirements).map((a) => string(object(a).name)).filter(Boolean);
    places.unshift(["Remote", ...areas].join(" - "));
  }
  return places.join("; ");
}

const closed = /\b(?:no longer accepting applications|job (?:is |has been )?(?:closed|filled|expired)|position has been filled|posting has expired)\b/i;

/** Prefer a single JobPosting record. Never turn a board/search page into a pretend job. */
export function parsePosting(result: WebResult, html = "", now = Date.now()): ParsedPosting {
  let url: string;
  try { url = canonicalUrl(result.url); } catch { return { reason: "not a public HTTPS listing" }; }
  const rows: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { rows.push(...records(JSON.parse(match[1]!))); } catch { /* malformed markup: try another block */ }
  }
  if (rows.length > 1) return { reason: "multiple jobs on one page" };
  const text = result.text?.trim() ?? "";
  if (closed.test(text) || closed.test(plainText(html))) return { reason: "posting is closed" };
  let title = "", company = "", where = "", description = "";
  let postedAt: string | undefined;
  const row = rows[0];
  if (row) {
    const expiry = date(row.validThrough);
    if (expiry && Date.parse(expiry) < now) return { reason: "posting is expired" };
    title = plainText(string(row.title));
    company = plainText(string(object(row.hiringOrganization).name));
    where = location(row);
    description = plainText(string(row.description));
    postedAt = date(row.datePosted);
  } else {
    // Explicit labels and recognizable individual-posting headers only; don't invent missing metadata.
    const labeled = (label: string) => text.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,4}\\s*)?(?:\\*\\*)?(?:${label})(?:\\*\\*)?\\s*:\\s*(.+)`, "i"))?.[1]?.replace(/\*\*/g, "").trim() ?? "";
    title = labeled("Job title|Position title");
    company = labeled("Company|Employer");
    where = labeled("Location|Job location");
    const header = (result.title ?? "").replace(/\s*\|\s*(?:LinkedIn|Indeed|Glassdoor|Built In|Wellfound).*$/i, "").replace(/^Job Application for\s+/i, "");
    const at = header.match(/^(.+?)\s+at\s+(.+?)(?:\s*\|.*)?$/i);
    const hiring = header.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+)$/i);
    if (at) { title ||= at[1]!.trim(); company ||= at[2]!.trim(); }
    if (hiring) { company ||= hiring[1]!.trim(); title ||= hiring[2]!.trim(); where ||= hiring[3]!.trim(); }
    // These fields must occur in actual page content, not only an index title.
    if (!title || !company || !text.toLowerCase().includes(title.toLowerCase()) || !text.toLowerCase().includes(company.toLowerCase())) return { reason: "could not extract one job and employer" };
    if (!/\b(?:qualifications|requirements|responsibilities|what you.ll (?:do|bring)|about (?:the|this) role)\b/i.test(text) || text.length < 200) return { reason: "full job description unavailable" };
    postedAt = date(labeled("Date posted|Posted(?: on)?|datePosted"));
    description = text;
  }
  if (!title || !company || description.length < 200) return { reason: "incomplete job description or metadata" };
  if (postedAt && Date.parse(postedAt) > now) return { reason: "future posting date" };
  const job: RawJob = { id: `web:${createHash("sha256").update(url).digest("hex").slice(0, 24)}`, title, company, location: where, description, applyUrl: url, postingUrl: url, ...(postedAt ? { postedAt } : {}) };
  return { job, method: row ? "jobposting" : "page-text" };
}

