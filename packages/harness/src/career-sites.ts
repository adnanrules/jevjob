// The second source: employers' own career sites, with direct apply links, covering employers the Indeed plugin's small
// index never returns. No LLM tokens: the MCP server reads them itself.
//
//   0. Entry-level searches start with the new-grad feed (new-grad-feed.ts): curated new-grad roles, each read
//      straight from the employer's posting. Works for everyone.
//   Optional, when Joboid (the author's job-search tool) is installed alongside and JOBOID_DIR points at it:
//   1. One Joboid title search over the companies it follows (fast; a background refresh keeps its cache current).
//   2. Rank candidates from the listing alone: not seen before, title and level fit, place, date.
//   3. Fetch full postings best-first and put each through the same checks as Indeed postings (admit).
//      In-window first; near misses are fetched only when the in-window ones can't fill the batch.
import { normalizeJobs } from "@jevjob/core";
import { placement } from "./geography";
import { admit, ageOf, jobsSummary, load, nextStep, readSearch, saveSearch, settle, skip, widenSteps, type JobsSummary, type Search } from "./indeed";
import { levelFit, searchDays, titleFit } from "./intent";
import { joboid } from "./joboid";
import { addFromFeed, FEED_CREDIT, type FeedStep } from "./new-grad-feed";
import { joboidDir } from "./paths";
import { postingKey } from "./posting";
import { earlyTitleMismatch } from "./search-quality";

/** Full postings fetched at once, and at most per call (each is a `joboid job` process). */
const PARALLEL = 8;
const MAX_FETCHES = 80;
/**
 * Listings without a location ("", "3 Locations") are fetched to find out where they are, but only a couple per
 * employer: some career sites never say, and one global employer can otherwise use up every fetch.
 */
const UNKNOWN_PER_EMPLOYER = 2;

interface Listing {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  posted?: string | null;
}

export interface CareerSitesSummary extends JobsSummary {
  /** Listings matching the titles in Joboid's cache, before any checks. */
  matched: number;
  /** Full postings fetched and checked. */
  examined: number;
  /** The new-grad feed step (entry-level searches only). */
  feed: FeedStep & { source: string };
}

const isoDate = (posted: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}$/.test(posted ?? "") ? posted! : undefined);

/** Candidates from the listing alone, best first: in the window, in-state, explicit entry-level titles, newest. */
function candidates(s: Search, listings: Listing[]): Listing[] {
  const seen = new Set(s.seen);
  const scored = listings.flatMap((l) => {
    if (seen.has(postingKey({ company: l.company, title: l.title, location: l.location ?? "" }))) return [];
    if (!titleFit(l.title, s.plan) || earlyTitleMismatch(l.title, s.plan)) return [];
    const level = levelFit(l.title, s.plan);
    const where = placement(l.location, s.plan); // "2 Locations" is unknown until the full posting says
    if (level === null || where === "no") return [];
    // Joboid writes "before 2026-08-27" when it only knows an upper bound; with a window, that can't be placed.
    const posted = isoDate(l.posted);
    if (!posted && searchDays(s.plan)) return [];
    const age = ageOf(s, posted);
    if (age === "old") return [];
    return [{ l, inWindow: age === "in" ? 1 : 0, place: where === "home" ? 2 : where === "remote" ? 1 : 0, level, posted: posted ?? "" }];
  });
  scored.sort((a, b) => b.inWindow - a.inWindow || b.place - a.place || b.level - a.level || b.posted.localeCompare(a.posted));
  const unknown = new Map<string, number>();
  return scored.flatMap((x) => {
    if (x.place > 0) return [x.l];
    const n = (unknown.get(x.l.company) ?? 0) + 1;
    unknown.set(x.l.company, n);
    return n <= UNKNOWN_PER_EMPLOYER ? [x.l] : [];
  });
}

export async function searchCareerSites(): Promise<CareerSitesSummary> {
  const s = readSearch();
  if (!s) throw new Error("Start a search first (start_search).");
  const feed = await addFromFeed(s);
  saveSearch(s);
  const dir = joboidDir();
  if (!dir) {
    s.careerSites = "done";
    settle(s);
    saveSearch(s);
    return { ...jobsSummary(s, feed.added), matched: 0, examined: 0, feed: { ...feed, source: FEED_CREDIT }, next: nextStep(s) };
  }

  // With a date window, ask Joboid only for what could ever be admitted (up to the widest step).
  const requested = searchDays(s.plan);
  const args = ["search", "--title", s.plan.titles.join("|"), "--limit", "20000"];
  if (requested) args.push("--days", String(Math.ceil(widenSteps(requested).at(-1) ?? requested)));
  let found = (await joboid(dir, [...args, "--no-refresh"])) as { jobs?: Listing[] };
  if (!found.jobs?.length) found = (await joboid(dir, args)) as { jobs?: Listing[] }; // empty cache: fill it once
  const queue = candidates(s, found.jobs ?? []);

  const seen = new Set(s.seen);
  let examined = 0;
  let addedNow = feed.added;
  const want = () => s.target - s.loaded - s.queue.length;
  for (let i = 0; i < queue.length && examined < MAX_FETCHES && want() > 0; i += PARALLEL) {
    const batch = queue.slice(i, i + PARALLEL);
    const full = await Promise.all(batch.map((c) => joboid(dir, ["job", c.id]).catch(() => null)));
    examined += batch.length;
    for (const c of batch) seen.add(postingKey({ company: c.company, title: c.title, location: c.location ?? "" }));
    const { jobs, rejected } = normalizeJobs(full.filter(Boolean));
    for (const r of rejected) skip(s, r.reason === "posting is closed" ? "closed" : "unreadable posting");
    s.seen = [...seen];
    const admitted = jobs.flatMap((job) => admit(s, job, { requirePlace: true }) ?? []);
    addedNow += load(s, admitted.slice(0, Math.max(0, s.target - s.loaded)));
  }

  s.careerSites = "done";
  const before = s.loaded;
  settle(s);
  addedNow += s.loaded - before;
  saveSearch(s);
  return { ...jobsSummary(s, addedNow), matched: found.jobs?.length ?? 0, examined, feed: { ...feed, source: FEED_CREDIT }, next: nextStep(s) };
}
