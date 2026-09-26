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

export async function readPage(url: string): Promise<Posting | null> {
  const html = await get(url, "text");
  const first = jobPostings(html)[0];
  return first ? fromJobPosting(first, url) : null;
}
