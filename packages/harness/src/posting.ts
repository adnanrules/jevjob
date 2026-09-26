// Shared helpers for postings that arrive as HTML or loose text (Indeed details, pages a harness read itself).
import type { RawJob } from "@jevjob/core";

/** HTML → plain text that keeps list and paragraph structure (the requirement extractor depends on it). */
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

/** Drops tracking parameters so the same listing shared twice is recognized as one. */
export function canonicalUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Not a web URL");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$|trk$|trackingId$|refId$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url.href;
}

/**
 * The same job reposted (different ids, different tracking links) collapses to one key: employer + title + city.
 * Indeed hands out a new short link per request, so links alone can't de-duplicate.
 */
export function postingKey(job: Pick<RawJob, "company" | "title" | "location">): string {
  const norm = (s: string) => s.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|co)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const city = norm(job.location.split(/[;,]/)[0] ?? "");
  return `${norm(job.company)}|${norm(job.title)}|${city}`;
}
