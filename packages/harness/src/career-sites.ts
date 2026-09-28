// The second source: employers' own career sites, with direct apply links, covering employers the Indeed plugin's small
// index never returns. No LLM tokens: the MCP server reads them itself.
//
//   0. Entry-level searches start with the new-grad feed (new-grad-feed.ts): curated new-grad roles, each read
//      straight from the employer's posting. Works for everyone.
//   1. Company boards (boards.ts): every open job at ~4,500 employers' own job boards, any level. Works for everyone.
//   Optional, when Joboid (the author's job-search tool) is installed alongside and JOBOID_DIR points at it:
//   2. One Joboid title search over the companies it follows (fast; a background refresh keeps its cache current).
//   2. Rank candidates from the listing alone: not seen before, title and level fit, place, date.
//   3. Fetch full postings best-first and put each through the same checks as Indeed postings (admit).
//      In-window first; near misses are fetched only when the in-window ones can't fill the batch.
import { normalizeJobs } from "@jevjob/core";
import { placement, placeRank } from "./geography";
import { admit, ageOf, jobsSummary, load, nextStep, readSearch, saveSearch, settle, skip, widenSteps, type JobsSummary, type Search } from "./indeed";
import { levelFit, searchDays, titleFit } from "./intent";
import { joboid } from "./joboid";
import { addFromBoards, type BoardsStep } from "./boards";
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
  /** The company boards step. */
  boards: BoardsStep;
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
    return [{ l, inWindow: age === "in" ? 1 : 0, place: placeRank(where), level, posted: posted ?? "" }];
  });
  scored.sort((a, b) => b.inWindow - a.inWindow || b.place - a.place || b.level - a.level || b.posted.localeCompare(a.posted));
  const unknown = new Map<string, number>();
  return scored.flatMap((x) => {
    if (x.place > 0) return [x.l]; // known place; unknown ones are capped per employer
    const n = (unknown.get(x.l.company) ?? 0) + 1;
    unknown.set(x.l.company, n);
    return n <= UNKNOWN_PER_EMPLOYER ? [x.l] : [];
  });
}

const NO_FEED: FeedStep = { matched: 0, read: 0, added: 0 };
/** One call stays well under the ~60 s most assistants allow a tool; unfinished work continues on the next call. */
const CALL_BUDGET_MS = 40_000;
const MAX_PASSES = 3;
const NO_BOARDS: BoardsStep = { boards: 0, listed: 0, matched: 0, read: 0, added: 0 };

/**
 * `indeedUnavailable`: the assistant has no Indeed plugin, or it's rate-limited. Its planned searches are dropped, so
 * a short search can widen its date window instead of waiting for Indeed.
 */
export async function searchCareerSites({ indeedUnavailable = false } = {}): Promise<CareerSitesSummary> {
  const s = readSearch();
  if (!s) throw new Error("Start a search first (start_search).");
  if (indeedUnavailable) s.saturated = [...new Set([...s.saturated, ...s.areas.map((a) => a.query.toLowerCase())])];
  if (s.careerSites === "done") {
    // Already searched (a second call, e.g. to report that Indeed is unavailable): just move the search along.
    const before = s.loaded;
    settle(s);
    saveSearch(s);
    return { ...jobsSummary(s, s.loaded - before), matched: 0, examined: 0, feed: { ...NO_FEED, source: FEED_CREDIT }, boards: NO_BOARDS, next: nextStep(s) };
  }
  const deadline = Date.now() + CALL_BUDGET_MS;
  s.careerPasses = (s.careerPasses ?? 0) + 1;
  const feed = await addFromFeed(s, deadline);
  saveSearch(s);
  const boards = await addFromBoards(s, deadline);
  saveSearch(s);
  const unfinished = boards.finished === false && s.loaded < s.target && s.careerPasses < MAX_PASSES;
  if (unfinished) {
    // Out of time with employers left: keep what's loaded, and let `next` ask for another pass.
    return { ...jobsSummary(s, feed.added + boards.added), matched: 0, examined: 0, feed: { ...feed, source: FEED_CREDIT }, boards, next: nextStep(s) };
  }
  const dir = joboidDir();
  if (!dir) {
    s.careerSites = "done";
    const before = s.loaded;
    settle(s);
    saveSearch(s);
    return { ...jobsSummary(s, feed.added + boards.added + s.loaded - before), matched: 0, examined: 0, feed: { ...feed, source: FEED_CREDIT }, boards, next: nextStep(s) };
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
  let addedNow = feed.added + boards.added;
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
  return { ...jobsSummary(s, addedNow), matched: found.jobs?.length ?? 0, examined, feed: { ...feed, source: FEED_CREDIT }, boards, next: nextStep(s) };
}
