// The fallback reader: schema.org JobPosting data embedded in a posting page. Google for Jobs requires it, so most
// career sites that have no public API still include it. Pages that only render with JavaScript can't be read.
import type { Posting } from "./types";
import { get, text } from "./http";

/** Every JobPosting object in a page's JSON-LD blocks (they nest in arrays and @graph). */
export function jobPostings(html: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const item = stack.pop();
      if (Array.isArray(item)) stack.push(...item);
      else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        if (obj["@graph"]) stack.push(obj["@graph"]);
        const type = obj["@type"];
        if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) found.push(obj);
      }
    }
  }
  return found;
}

function locationOf(p: Record<string, unknown>): string {
  const locs = ([] as unknown[]).concat(p.jobLocation ?? []);
  const names = locs.map((l) => {
    const address = (l as { address?: unknown })?.address;
    if (typeof address === "string") return address;
    const a = (address ?? {}) as Record<string, unknown>;
    const country = typeof a.addressCountry === "object" ? (a.addressCountry as { name?: string })?.name : a.addressCountry;
    return [a.addressLocality, a.addressRegion, country].filter(Boolean).join(", ");
  });
  const remote = p.jobLocationType === "TELECOMMUTE" ? ["Remote"] : [];
  return [...names, ...remote].filter(Boolean).join("; ");
}

/** A JobPosting object → Posting (description as plain text). */
export function fromJobPosting(p: Record<string, unknown>, url: string): Posting | null {
  const description = text(String(p.description ?? ""));
  if (!description) return null;
  const posted = typeof p.datePosted === "string" ? p.datePosted.slice(0, 10) : undefined;
  return {
    title: text(String(p.title ?? "")),
    location: locationOf(p),
    ...(posted && /^\d{4}-\d{2}-\d{2}$/.test(posted) && { postedAt: posted }),
    postingUrl: typeof p.url === "string" ? p.url : url,
    applyUrl: typeof p.url === "string" ? p.url : url,
    description,
  };
}

/** Headings that start a posting's own content, and lines where the page around it takes over again. */
const SECTION = /^(?:job description|description|about (?:the|this) (?:role|job|position|opportunity)|the role|role overview|overview|summary|position summary|(?:key |your |primary |essential )?(?:responsibilities|duties)|what you(?:'|’)?ll (?:do|work on|bring)|what you will do|who you are|what we(?:'|’)?re looking for|what you bring|(?:basic |minimum |preferred |required |desired )?(?:qualifications|requirements|skills)(?: and experience)?|you have|nice to have|bonus points)\s*:?$/i;
const PAGE_ENDS = /^(?:apply(?: now| for this job)?|share(?: this job)?|similar jobs|related jobs|recommended jobs|back to (?:search|jobs)|privacy|cookie|terms of use|© ?\d{4}|copyright|join our talent community|sign up for job alerts)\b/i;

/**
 * For pages with no JobPosting data but a server-rendered posting (TikTok, Google, TalentBrew sites like L3Harris):
 * the text from just before the first posting heading to where the page's own chrome resumes. Returns null unless it
 * really looks like a posting: a known heading and at least 400 characters.
 */
export function postingText(html: string): { title: string; description: string } | null {
  const body = (html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html)
    .replace(/<(script|style|noscript|svg|nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const lines = text(body).split("\n").map((l) => l.replace(/^-\s*/, (m) => m).trim()).filter(Boolean);
  const heading = (l: string) => l.length < 70 && SECTION.test(l.replace(/^-\s*/, ""));
  const first = lines.findIndex(heading);
  if (first < 0) return null;
  let last = first;
  lines.forEach((l, i) => { if (heading(l)) last = i; });
  let end = lines.findIndex((l, i) => i > last && l.length < 60 && PAGE_ENDS.test(l));
  if (end < 0) end = Math.min(lines.length, last + 80);
  // A short lead-in before the first heading is usually the summary; skip menus (runs of very short lines).
  let start = first;
  while (start > 0 && first - start < 8 && lines[start - 1]!.length > 60) start--;
  const description = lines.slice(start, end).join("\n");
  if (description.length < 400) return null;
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1];
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = text(ogTitle ?? h1 ?? pageTitle ?? "").split(/\s+[|–—]\s+/)[0]!.trim();
  return { title, description };
}

export async function readPage(url: string): Promise<Posting | null> {
  const html = await get(url, "text");
  const first = jobPostings(html)[0];
  const structured = first ? fromJobPosting(first, url) : null;
  if (structured) return structured;
  const page = postingText(html);
  return page && { title: page.title, location: "", postingUrl: url, applyUrl: url, description: page.description };
}
