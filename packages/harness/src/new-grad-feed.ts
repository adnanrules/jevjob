// The new-grad feed: github.com/SimplifyJobs/New-Grad-Positions, a community-curated list of entry-level roles
// (updated daily), each linking to the employer's own posting. For an entry-level search it's the best source there
// is: every row is already new-grad, and the links go straight to Workday, Greenhouse, Oracle, iCIMS and so on.
//
//   1. Download the list (cached for a few hours). It has no license, so it's read at run time and credited,
//      never copied into this repo.
//   2. Filter from the list alone: active, role family, place, date window (near misses held for widening).
//   3. Read each full posting from the employer's own system (readers/: Workday, Greenhouse, Oracle, iCIMS, … or the
//      page's schema.org JobPosting) and put it through the same checks as every other source (admit).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeJobs, normalizePosting, type RawJob } from "@jevjob/core";
import { placement } from "./geography";
import { admit, ageOf, load, skip, type Search } from "./indeed";
import { levelFit, titleFit, type SearchPlan } from "./intent";
import { FEED_CACHE_DIR } from "./paths";
import { postingKey } from "./posting";
import { readPostings, type ReadResult } from "./readers";

export const FEED_URL = "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json";
export const FEED_CREDIT = "github.com/SimplifyJobs/New-Grad-Positions";
const FEED_MAX_AGE_MS = 6 * 3_600_000;
/** Postings read per `joboid postings` call (it reads them concurrently), and at most per search step. */
const BATCH = 25;
const MAX_READS = 100;

export interface FeedListing {
  id?: string;
  company_name: string;
  title: string;
  url: string;
  locations?: string[];
  /** Unix seconds. */
  date_posted?: number;
  category?: string;
  active?: boolean;
  is_visible?: boolean;
}

/** The feed's role families, and the words in a plan's titles that ask for each. */
const CATEGORY_WORDS: Array<[string, RegExp]> = [
  ["Software", /\b(software|developer|engineer|full[- ]?stack|back[- ]?end|front[- ]?end|web|programmer|swe|application|qa|devops|cloud)\b/i],
  ["AI/ML/Data", /\b(data|machine learning|ml|ai|analytics?|analyst|scientist|intelligence)\b/i],
  ["Quant", /\b(quant|quantitative)\b/i],
  ["Hardware", /\b(hardware|embedded|firmware|fpga|asic|electrical)\b/i],
  ["Product", /\b(product manager)\b/i],
];

export function planCategories(plan: SearchPlan): Set<string> {
  const text = plan.titles.join(" | ");
  return new Set(CATEGORY_WORDS.filter(([, words]) => words.test(text)).map(([name]) => name));
}

/**
 * Feed rows worth reading, best first: in the window, then in-state, then newest. Pure, so it's unit-tested.
 * A row fits the role if its title matches the plan's titles, or its category is one the plan's titles ask for
 * ("any coding role" plans list many titles; the feed's own category catches the ones worded differently).
 */
export function feedCandidates(s: Search, listings: FeedListing[]): FeedListing[] {
  const seen = new Set(s.seen);
  const categories = planCategories(s.plan);
  const scored = listings.flatMap((l) => {
    if (!l.active || l.is_visible === false || !l.url) return [];
    const location = (l.locations ?? []).join("; ");
    if (seen.has(postingKey({ company: l.company_name, title: l.title, location }))) return [];
    if (!titleFit(l.title, s.plan) && !(l.category && categories.has(l.category))) return [];
    if (levelFit(l.title, s.plan) === null) return [];
    const where = placement(location, s.plan);
    if (where === "no") return [];
    const posted = l.date_posted ? new Date(l.date_posted * 1000).toISOString().slice(0, 10) : undefined;
    const age = ageOf(s, posted);
    if (age === "old") return [];
    return [{ l, inWindow: age === "in" ? 1 : 0, home: where === "home" ? 1 : 0, posted: l.date_posted ?? 0 }];
  });
  scored.sort((a, b) => b.inWindow - a.inWindow || b.home - a.home || b.posted - a.posted);
  return scored.map((x) => x.l);
}

async function loadFeed(): Promise<FeedListing[]> {
  mkdirSync(FEED_CACHE_DIR, { recursive: true });
  const file = path.join(FEED_CACHE_DIR, "new-grad.json");
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < FEED_MAX_AGE_MS) return JSON.parse(readFileSync(file, "utf8")) as FeedListing[];
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`New-grad feed: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return JSON.parse(text) as FeedListing[];
}

/** Full postings, cached per URL for a day so re-runs and "more" don't re-read them. Closed postings are cached too. */
async function readCached(rows: FeedListing[]): Promise<ReadResult[]> {
  // Versioned: a change to ReadResult's shape starts a fresh cache instead of misreading old entries.
  const cacheDir = path.join(FEED_CACHE_DIR, "postings-v2");
  mkdirSync(cacheDir, { recursive: true });
  const cacheFile = (url: string) => path.join(cacheDir, `${createHash("sha256").update(url).digest("hex").slice(0, 24)}.json`);
  const fresh = (file: string) => existsSync(file) && Date.now() - statSync(file).mtimeMs < 24 * 3_600_000;

  const results = new Map<string, ReadResult>();
  const todo = rows.filter((r) => {
    const file = cacheFile(r.url);
    if (fresh(file)) {
      const cached = JSON.parse(readFileSync(file, "utf8")) as ReadResult;
      if (cached.ok ? typeof cached.posting?.description === "string" : cached.closed) results.set(r.url, cached);
    }
    return !results.has(r.url);
  });
  for (const r of await readPostings(todo.map((row) => row.url))) {
    results.set(r.url, r);
    if (r.ok || r.closed) writeFileSync(cacheFile(r.url), JSON.stringify(r));
  }
  return rows.map((r) => results.get(r.url) ?? { url: r.url, ok: false, error: "not read" });
}

export interface FeedStep {
  /** Feed rows that fit the search from the list alone. */
  matched: number;
  /** Postings read in full. */
  read: number;
  added: number;
}

/**
 * Adds new-grad feed postings to the search until the batch is full or the fitting rows run out. Only for
 * entry-level (or any-level) plans: every row in the feed is a new-grad role.
 */
export async function addFromFeed(s: Search): Promise<FeedStep> {
  if (s.plan.level !== "entry" && s.plan.level !== "any") return { matched: 0, read: 0, added: 0 };
  let listings: FeedListing[];
  try {
    listings = await loadFeed();
  } catch {
    skip(s, "new-grad feed unavailable");
    return { matched: 0, read: 0, added: 0 };
  }
  const rows = feedCandidates(s, listings);
  const seen = new Set(s.seen);
  let read = 0;
  let added = 0;
  const want = () => s.target - s.loaded - s.queue.length;
  for (let i = 0; i < rows.length && read < MAX_READS && want() > 0; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const results = await readCached(batch);
    read += batch.length;
    for (const row of batch) seen.add(postingKey({ company: row.company_name, title: row.title, location: (row.locations ?? []).join("; ") }));
    s.seen = [...seen];

    const raw = results.flatMap((r) => {
      if (!r.ok) {
        skip(s, r.closed ? "closed" : "unreadable posting");
        return [];
      }
      const { posting } = r;
      const row = batch.find((b) => b.url === r.url)!;
      // Some APIs omit the place or date on a single posting; the feed row has both.
      const postedAt = posting.postedAt ?? (row.date_posted ? new Date(row.date_posted * 1000).toISOString().slice(0, 10) : undefined);
      return [{
        id: `feed:${createHash("sha256").update(row.url).digest("hex").slice(0, 20)}`,
        company: row.company_name,
        title: posting.title || row.title,
        location: posting.location || (row.locations ?? []).join("; "),
        applyUrl: posting.applyUrl,
        postingUrl: posting.postingUrl,
        description: normalizePosting(posting.description),
        ...(postedAt && { postedAt }),
      }];
    });
    const { jobs } = normalizeJobs(raw);
    // The row already passed the role check on title or the feed's own category (feedCandidates).
    const admitted = jobs.flatMap((job: RawJob) => admit(s, job, { requirePlace: true, roleChecked: true }) ?? []);
    added += load(s, admitted.slice(0, Math.max(0, s.target - s.loaded)));
  }
  return { matched: rows.length, read, added };
}
