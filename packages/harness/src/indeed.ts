// Indeed, through the harness. The Indeed plugin lives in the chat app (Claude, Codex), so JevJob can't call it;
// the chat model does, and hands JevJob the plugin's raw output. JevJob does everything else, so the model never
// has to judge a posting:
//
//   start_search         plan: titles, level, and areas in widening order (city → nearby → state → remote US)
//   add_search_results   parse a search_jobs result; drop wrong titles/levels/places/duplicates; hold back
//                        postings that only miss the date window; answer "fetch these ids"
//   add_jobs             parse get_job_details (or postings from the model's own web search); final checks; load
//   search_career_sites  (career-sites.ts) the same checks over Joboid's tracked employer career sites
//
// When the search runs short, it degrades in a fixed order instead of giving up:
//   1. An area where Indeed keeps returning postings it already showed is "saturated" and skipped.
//   2. Once Indeed is used up, Joboid's company career sites are searched (direct employer links).
//   3. Still short: the "posted within" window widens step by step (7 → 14 → 30 days) and releases the
//      near misses it held back. Those are tagged, and rank below in-window jobs of the same tier.
//
// Everything lives in .jevjob/search.json, so `more` continues the same search where it left off.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeJobs, normalizePosting, type RawJob } from "@jevjob/core";
import { homeState, placement, searchAreas, type SearchArea } from "./geography";
import { levelFit, searchDays, titleFit, type SearchPlan } from "./intent";
import { currentJobs, loadJobs } from "./jobs";
import { joboidDir, SEARCH_FILE } from "./paths";
import { canonicalUrl, postingKey } from "./posting";
import { earlyTitleMismatch, jobFitIssue } from "./search-quality";

/** The most postings shown and classified at a time. */
export const BATCH_SIZE = 50;

/**
 * An Indeed search that adds no usable posting (in the window, or a near miss) counts as dry. Counting never-seen
 * postings wasn't enough: Indeed keeps mixing in new but irrelevant listings (AI-trainer gigs, senior roles), so
 * no search ever looked dry and every planned search ran.
 */
/** Dry searches in a row before an area is skipped. */
const DRY_AREA = 2;
/** Dry searches in a row, across areas, before every local area is skipped (remote is a different pool). */
const DRY_LOCAL = 4;

export interface Listing {
  indeedId: string;
  title: string;
  company: string;
  location: string;
  postedAt?: string | undefined;
  url: string;
  jobType?: string | undefined;
  pay?: string | undefined;
}

type Queued = Listing & { home: boolean };
type Candidate = RawJob & { home: boolean };

export interface Search {
  plan: SearchPlan;
  areas: SearchArea[];
  /** How many postings this search should have loaded; grows by BATCH_SIZE with each "more". */
  target: number;
  /** Duplicate keys already accepted or rejected, so no posting is looked at twice. */
  seen: string[];
  /** Accepted listings waiting for their full posting, best first. */
  queue: Queued[];
  /** (title@area) pairs already searched. */
  searched: string[];
  loaded: number;
  /** The first load of a new search replaces the pool; later ones append. */
  started: boolean;
  skipped: Record<string, number>;
  /** Listings that fit except for their date: released if the window widens. */
  nearMisses: Queued[];
  /** Full postings (career sites, web) that fit except for their date. */
  nearMissJobs: Candidate[];
  /** The widened window in days, or null while it's still the one the user asked for. */
  window: number | null;
  /** Consecutive dry Indeed searches per area, and overall. */
  dry: Record<string, number>;
  dryStreak: number;
  /** Areas (search queries, lowercase) skipped because Indeed kept repeating itself there. */
  saturated: string[];
  careerSites: "pending" | "done" | "unavailable";
}

export function readSearch(): Search | null {
  if (!existsSync(SEARCH_FILE)) return null;
  const s = JSON.parse(readFileSync(SEARCH_FILE, "utf8")) as Partial<Search>;
  // Search files written before near misses and saturation existed.
  return { nearMisses: [], nearMissJobs: [], window: null, dry: {}, dryStreak: 0, saturated: [], careerSites: "done", ...s } as Search;
}
export function saveSearch(s: Search): void {
  mkdirSync(path.dirname(SEARCH_FILE), { recursive: true });
  writeFileSync(SEARCH_FILE, JSON.stringify(s, null, 2));
}
export const skip = (s: Search, reason: string) => void (s.skipped[reason] = (s.skipped[reason] ?? 0) + 1);

// ── Parsing the plugin's markdown ───────────────────────────────────────────

const field = (block: string, name: string) => block.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`))?.[1]?.trim();
/** The plugin writes "N/A" or "None" for missing values. */
const usable = (v: string | undefined) => (v && !/^(?:n\/?a|none|null)$/i.test(v) ? v : undefined);

/** "September 07, 2026" → "2026-09-07". Anything else → undefined (never guess a date). */
export function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(`${value} UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : undefined;
}

function listingFrom(block: string, title: string | undefined): Listing | null {
  const indeedId = field(block, "Job Id");
  const url = field(block, "View Job URL");
  if (!title || !indeedId || !url) return null;
  return {
    indeedId,
    title,
    company: usable(field(block, "Company")) ?? "",
    location: field(block, "Location") ?? "",
    postedAt: isoDate(field(block, "Posted on")),
    url,
    jobType: usable(field(block, "Job Type")),
    pay: usable(field(block, "Compensation")),
  };
}

/** A search_jobs result (a list of "**Job Title:** …" blocks). Accepts the raw string or its {"result": …} wrapper. */
export function parseSearchResults(raw: string): Listing[] {
  const text = unwrap(raw);
  return text
    .split(/(?=\*\*Job Title:\*\*)/)
    .map((block) => listingFrom(block, field(block, "Job Title")))
    .filter((l): l is Listing => l !== null && l.company !== ""); // no employer: can't de-duplicate or apply sensibly
}

/**
 * A get_job_details result: "### Title", the same fields, then the description. The company can be missing
 * ("None") even when the search listing had it; add_jobs fills it in from the queued listing.
 */
export function parseJobDetails(raw: string): (Listing & { description: string }) | null {
  const text = unwrap(raw);
  const title = text.match(/^\s*#{1,4}\s*(.+)$/m)?.[1]?.trim();
  const listing = listingFrom(text, title);
  if (!listing) return null;
  // The description is everything after the last metadata line.
  const lines = text.split("\n");
  const lastMeta = lines.reduce((at, line, i) => (/^\s*\*\*[\w ]+:\*\*/.test(line) ? i : at), 0);
  return { ...listing, description: lines.slice(lastMeta + 1).join("\n").trim() };
}

function unwrap(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { result?: unknown };
      if (typeof parsed.result === "string") return parsed.result;
    } catch {
      // Not JSON after all; treat as markdown.
    }
  }
  return trimmed.replace(/\\n/g, "\n");
}

// ── Dates: in the window, a near miss, or too old ───────────────────────────

/**
 * The windows a short search may widen to, in order. At most 4× the request (and at least up to 30 days),
 * so "last 7 days" can become 14, then 30, but never "any time".
 */
export function widenSteps(days: number): number[] {
  const limit = Math.max(30, days * 4);
  return [3, 7, 14, 30, 60, 90].filter((w) => w > days && w <= limit);
}

const ageInDays = (postedAt: string) => (Date.now() - Date.parse(postedAt)) / 86_400_000;

type Age = "in" | "widened" | "held" | "old";
/** in: inside the requested window. widened: inside the current widened one. held: a near miss. old: beyond any step. */
export function ageOf(s: Search, postedAt: string | undefined): Age {
  const requested = searchDays(s.plan);
  if (!requested || !postedAt) return "in"; // an undated posting can't be shown to be old
  const age = ageInDays(postedAt);
  if (age <= requested) return "in";
  if (s.window && age <= s.window) return "widened";
  return age <= (widenSteps(requested).at(-1) ?? requested) ? "held" : "old";
}

// ── The search ──────────────────────────────────────────────────────────────

export interface SearchBrief {
  target: number;
  titles: string[];
  level: SearchPlan["level"];
  postedWithinDays: number | null;
  /** Set once the window has widened because the requested one ran short. */
  widenedTo: number | null;
  /** Search these in order; stop once `fetch` lists enough ids. */
  areas: SearchArea[];
  homeState: string | null;
  /** Areas skipped because Indeed only repeated postings it had already shown. */
  saturated: string[];
  next: string;
}

function brief(s: Search): SearchBrief {
  return {
    target: s.target,
    titles: indeedQueries(s.plan),
    level: s.plan.level,
    postedWithinDays: searchDays(s.plan) ?? null,
    widenedTo: s.window,
    areas: s.areas,
    homeState: homeState(s.plan),
    saturated: s.saturated,
    next: nextStep(s),
  };
}

/** A few distinct search phrases: Indeed matches loosely, so three or four titles cover a role. */
function indeedQueries(plan: SearchPlan): string[] {
  const prefix = plan.level === "entry" ? "entry level " : plan.level === "senior" ? "senior " : "";
  return [...new Set(plan.titles.slice(0, 4).map((t) => `${prefix}${t}`.trim()))];
}

export function nextStep(s: Search): string {
  if (s.loaded >= s.target) return "Done. Call open_app (the open app picks up the new postings).";
  const need = s.target - s.loaded - s.queue.length;
  const fetch = `Fetch the ${s.queue.length} queued postings with get_job_details and pass them to add_jobs.`;
  if (s.queue.length && need <= 0) return fetch;
  const pending = pendingSearches(s)[0];
  if (pending) return `Search Indeed: search_jobs(search: "${pending.title}", location: "${pending.area.query}", country_code: "US"), then add_search_results.`;
  if (s.careerSites === "pending") return "Indeed is used up. Call search_career_sites (company career sites through Joboid, direct employer links).";
  if (s.queue.length) return `${fetch} Every source is used up after that.`;
  return "Every source is used up. Call open_app and report how many postings loaded and the main skip reasons.";
}

function pendingSearches(s: Search): Array<{ title: string; area: SearchArea }> {
  const done = new Set(s.searched.map((k) => k.toLowerCase()));
  const saturated = new Set(s.saturated);
  // Area-major order: every title in the city before moving outward, so in-state jobs come first.
  return s.areas
    .filter((area) => !saturated.has(area.query.toLowerCase()))
    .flatMap((area) => indeedQueries(s.plan).map((title) => ({ title, area })))
    .filter((p) => !done.has(`${p.title}@${p.area.query}`.toLowerCase()));
}

/** A new search. The pool is replaced when its first postings arrive, so an empty search never wipes a good pool. */
export function startSearch(plan: SearchPlan): SearchBrief {
  const s: Search = {
    plan,
    areas: searchAreas(plan),
    target: Math.min(plan.count, BATCH_SIZE),
    seen: [],
    queue: [],
    searched: [],
    loaded: 0,
    started: false,
    skipped: {},
    nearMisses: [],
    nearMissJobs: [],
    window: null,
    dry: {},
    dryStreak: 0,
    saturated: [],
    careerSites: joboidDir() ? "pending" : "unavailable",
  };
  saveSearch(s);
  return brief(s);
}

/** Same search, 50 more postings: continues through the remaining titles, areas and sources, never repeating a posting. */
export function moreFromSearch(): SearchBrief {
  const s = readSearch();
  if (!s) throw new Error("No search to continue. Start one with start_search.");
  s.target = s.loaded + BATCH_SIZE;
  // Career sites only fetched what the last batch needed; there may be more there now.
  if (s.careerSites === "done" && joboidDir()) s.careerSites = "pending";
  settle(s);
  saveSearch(s);
  return brief(s);
}

export interface ResultsSummary {
  parsed: number;
  /** Listings in this result that hadn't been seen before. */
  new: number;
  accepted: number;
  /** Held back because they're a little older than the window; used only if the search runs short. */
  nearMisses: number;
  skipped: Record<string, number>;
  /** Indeed job ids to fetch with get_job_details, best first. */
  fetch: string[];
  loaded: number;
  target: number;
  saturated: string[];
  widenedTo: number | null;
  next: string;
}

/** Filters one search_jobs result without fetching anything. */
export function addSearchResults(raw: string, searched?: { title: string; location: string }): ResultsSummary {
  const s = readSearch();
  if (!s) throw new Error("Start a search first (start_search).");
  const listings = parseSearchResults(raw);
  const area = (searched?.location ?? pendingSearches(s)[0]?.area.query ?? "").toLowerCase();
  const title = searched?.title ?? pendingSearches(s)[0]?.title; // without `searched`, assume it ran what it was told to
  if (title) s.searched.push(`${title}@${area}`);

  const seen = new Set(s.seen);
  const before = s.queue.length;
  const heldBefore = s.nearMisses.length;
  let fresh = 0;
  for (const l of listings) {
    const key = postingKey(l);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh++;
    if (!titleFit(l.title, s.plan)) { skip(s, "different role"); continue; }
    if (levelFit(l.title, s.plan) === null || earlyTitleMismatch(l.title, s.plan)) { skip(s, "wrong level"); continue; }
    const where = placement(l.location, s.plan);
    if (where === "no") { skip(s, "outside the area (and not remote)"); continue; }
    if (/internship/i.test(l.jobType ?? "") && !s.plan.internships) { skip(s, "internship"); continue; }
    const age = ageOf(s, l.postedAt);
    if (age === "old") { skip(s, "too old"); continue; }
    (age === "held" ? s.nearMisses : s.queue).push({ ...l, home: where === "home" });
  }
  s.seen = [...seen];
  const usable = s.queue.length - before + (s.nearMisses.length - heldBefore);
  noteDryness(s, area, usable);
  sortQueue(s);
  settle(s);
  saveSearch(s);

  const room = Math.max(0, s.target - s.loaded);
  return {
    parsed: listings.length,
    new: fresh,
    accepted: Math.max(0, s.queue.length - before),
    nearMisses: s.nearMisses.length - heldBefore,
    skipped: s.skipped,
    fetch: s.queue.slice(0, room).map((l) => l.indeedId),
    loaded: s.loaded,
    target: s.target,
    saturated: s.saturated,
    widenedTo: s.window,
    next: nextStep(s),
  };
}

/** Indeed's plugin draws from a small index: past a point, every search returns the same postings. Stop asking. */
function noteDryness(s: Search, area: string, usable: number): void {
  if (usable > 0) {
    s.dry[area] = 0;
    s.dryStreak = 0;
    return;
  }
  s.dry[area] = (s.dry[area] ?? 0) + 1;
  s.dryStreak++;
  const saturate = (q: string) => !s.saturated.includes(q) && s.saturated.push(q);
  if (s.dry[area]! >= DRY_AREA) saturate(area);
  if (s.dryStreak >= DRY_LOCAL) for (const a of s.areas) if (!a.remoteOnly) saturate(a.query.toLowerCase());
}

/** In-state first, then explicit entry-level titles, then in-window before widened, then newest. */
function sortQueue(s: Search): void {
  const outside = (l: Queued) => Number(ageOf(s, l.postedAt) !== "in");
  s.queue.sort((a, b) => Number(b.home) - Number(a.home) || (levelFit(b.title, s.plan) ?? 0) - (levelFit(a.title, s.plan) ?? 0) || outside(a) - outside(b) || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}

/**
 * Called after every step. If the search is short and every source is used up, widen the window one step at a
 * time until some near misses fit: listings join the fetch queue, full postings load right away.
 */
export function settle(s: Search): void {
  const requested = searchDays(s.plan);
  const short = () => s.loaded + s.queue.length < s.target;
  const stuck = () => pendingSearches(s).length === 0 && s.careerSites !== "pending";
  if (!requested || !short() || !stuck()) return;

  for (const step of widenSteps(requested).filter((w) => w > (s.window ?? requested))) {
    if (!short()) break;
    const previous = s.window;
    s.window = step;
    const fits = (postedAt: string | undefined) => ageOf(s, postedAt) === "widened";
    const listings = s.nearMisses.filter((l) => fits(l.postedAt));
    const jobs = s.nearMissJobs.filter((j) => fits(j.postedAt));
    if (!listings.length && !jobs.length) {
      s.window = previous; // a step that adds nothing isn't taken: the window stays as honest as possible
      continue;
    }
    s.nearMisses = s.nearMisses.filter((l) => !fits(l.postedAt));
    s.nearMissJobs = s.nearMissJobs.filter((j) => !fits(j.postedAt));
    s.queue.push(...listings);
    sortQueue(s);
    if (jobs.length) load(s, jobs.slice(0, Math.max(0, s.target - s.loaded)).map((j) => ({ ...j, outsideWindowDays: requested })));
  }
}

export interface WebPosting {
  title: string;
  company: string;
  location?: string | undefined;
  url: string;
  description: string;
  postedAt?: string | undefined;
}

export interface JobsSummary {
  loaded: number;
  target: number;
  addedNow: number;
  skipped: Record<string, number>;
  poolSize: number;
  saturated: string[];
  widenedTo: number | null;
  done: boolean;
  next: string;
}

/**
 * Final checks on one full posting: place, level, experience, date. Returns it ready to load (tagged when it's
 * only here because the window widened), or null when it was skipped or held back as a near miss.
 */
export function admit(s: Search, job: RawJob, { requirePlace = false } = {}): Candidate | null {
  const reject = (reason: string) => {
    skip(s, reason);
    return null;
  };
  const where = placement(job.location, s.plan);
  if (where === "no") return reject("outside the area (and not remote)");
  if (where === "unknown" && requirePlace) return reject("location not stated");
  const issue = jobFitIssue(job, s.plan);
  if (issue) return reject(issue);
  const home = where !== "remote";
  const requested = searchDays(s.plan);
  switch (ageOf(s, job.postedAt)) {
    case "old":
      return reject("too old");
    case "held":
      s.nearMissJobs.push({ ...job, home });
      return null;
    case "widened":
      return { ...job, home, ...(requested && { outsideWindowDays: requested }) };
    default:
      return { ...job, home };
  }
}

/** Adds admitted postings to the pool: in-state first, never a posting that's already there. Returns how many were new. */
export function load(s: Search, candidates: Candidate[]): number {
  candidates.sort((a, b) => Number(b.home) - Number(a.home));
  const { jobs } = normalizeJobs(candidates.map(({ home: _home, ...job }) => job));
  const existing = s.started && currentJobs().source === "harness" ? currentJobs().jobs : [];
  const existingKeys = new Set(existing.map(postingKey));
  // Also one per key within the batch: employers often post identical requisitions ("Software Engineer", same city).
  const fresh = jobs.filter((j) => {
    const key = postingKey(j);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  if (fresh.length) {
    loadJobs(fresh, { replace: !s.started });
    s.started = true;
  }
  s.loaded += fresh.length;
  return fresh.length;
}

export function jobsSummary(s: Search, addedNow: number): JobsSummary {
  return {
    loaded: s.loaded,
    target: s.target,
    addedNow,
    skipped: s.skipped,
    poolSize: currentJobs().jobs.length,
    saturated: s.saturated,
    widenedTo: s.window,
    done: s.loaded >= s.target,
    next: nextStep(s),
  };
}

/** Full postings: Indeed get_job_details output, or postings the model found with its own web search. */
export function addJobs(input: { indeedDetails?: string[] | undefined; postings?: WebPosting[] | undefined }): JobsSummary {
  const s = readSearch();
  if (!s) throw new Error("Start a search first (start_search).");
  const candidates: Candidate[] = [];
  const take = (job: RawJob) => {
    const ok = admit(s, job);
    if (ok) candidates.push(ok);
  };

  for (const raw of input.indeedDetails ?? []) {
    const d = parseJobDetails(raw);
    const queued = d && s.queue.find((q) => q.indeedId === d.indeedId);
    const company = d?.company || queued?.company;
    if (!d || !company) { skip(s, "unreadable job details"); continue; }
    s.queue = s.queue.filter((q) => q.indeedId !== d.indeedId);
    const job = { ...d, company };
    take({
      id: `indeed:${createHash("sha256").update(postingKey(job)).digest("hex").slice(0, 20)}`,
      title: job.title,
      company,
      location: job.location,
      applyUrl: job.url,
      postingUrl: job.url,
      description: normalizePosting(job.description),
      ...(job.postedAt && { postedAt: job.postedAt }),
      ...(job.pay && { pay: job.pay }),
    });
  }
  const seen = new Set(s.seen);
  for (const p of input.postings ?? []) {
    let url: string;
    try { url = canonicalUrl(p.url); } catch { skip(s, "invalid link"); continue; }
    const job = { title: p.title, company: p.company, location: p.location ?? "", description: normalizePosting(p.description) };
    const key = postingKey(job);
    if (seen.has(key)) continue;
    seen.add(key);
    take({ ...job, id: `web:${createHash("sha256").update(key).digest("hex").slice(0, 20)}`, applyUrl: url, postingUrl: url, ...(p.postedAt && { postedAt: p.postedAt }) });
  }
  s.seen = [...seen];

  const addedNow = load(s, candidates);
  const before = s.loaded;
  settle(s);
  saveSearch(s);
  return jobsSummary(s, addedNow + (s.loaded - before));
}

export function searchStatus(): (SearchBrief & { loaded: number; queued: number; nearMisses: number; careerSites: Search["careerSites"]; skipped: Record<string, number> }) | null {
  const s = readSearch();
  return s ? { ...brief(s), loaded: s.loaded, queued: s.queue.length, nearMisses: s.nearMisses.length + s.nearMissJobs.length, careerSites: s.careerSites, skipped: s.skipped } : null;
}
