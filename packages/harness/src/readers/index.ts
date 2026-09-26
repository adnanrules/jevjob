// Read job postings from their URLs, on whatever system the employer uses:
//   a known ATS → its public API (ats.ts); anything else → the page's schema.org JobPosting (page.ts).
// Many at once, with a concurrency cap, and one bad posting never sinks the batch.
import { READERS } from "./ats";
import { detect } from "./detect";
import { HttpError } from "./http";
import { readPage } from "./page";
import type { Posting } from "./types";

export { detect, type Ats, type Target } from "./detect";
export { jobPostings, fromJobPosting } from "./page";
export type { Posting } from "./types";

export type ReadResult = { url: string; ok: true; posting: Posting } | { url: string; ok: false; error: string; closed?: boolean };

export async function readPosting(url: string): Promise<Posting | null> {
  const target = detect(url);
  const posting = target ? await READERS[target.ats](target.parts, url) : null;
  if (posting?.description.trim()) return posting;
  return readPage(url); // unknown system, or an API that came back empty
}

export async function readPostings(urls: string[], concurrency = 8): Promise<ReadResult[]> {
  const results: ReadResult[] = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const url = urls[i]!;
      try {
        const posting = await readPosting(url);
        results[i] = posting?.description.trim() ? { url, ok: true, posting } : { url, ok: false, error: "no description found" };
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 0;
        results[i] = { url, ok: false, error: err instanceof Error ? err.message : String(err), closed: status === 404 || status === 410 };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}
