// Indeed, through the harness. The Indeed plugin lives in the chat app (Claude, Codex), so JevJob can't call it;
// the chat model does, and hands JevJob the plugin's raw output. JevJob does everything else, so the model never
// has to judge a posting:
//
//   start_search       plan: titles, level, and areas in widening order (city → nearby → state → remote US)
//   add_search_results parse a search_jobs result; drop wrong titles/levels/places/dates/duplicates;
//                      answer "fetch these ids" so the model only pulls full postings that could qualify
//   add_jobs           parse get_job_details (or postings from the model's own web search); final checks; load
//
// Everything lives in .jevjob/search.json, so `more` continues the same search where it left off.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeJobs, normalizePosting, type RawJob } from "@jevjob/core";
import { homeState, placement, searchAreas, type SearchArea } from "./geography";
import { levelFit, searchDays, titleFit, type SearchPlan } from "./intent";
import { currentJobs, loadJobs } from "./jobs";
import { SEARCH_FILE } from "./paths";
import { canonicalUrl, postingKey } from "./posting";
import { earlyTitleMismatch, jobFitIssue } from "./search-quality";

/** The most postings shown and classified at a time. */
export const BATCH_SIZE = 50;

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

interface Search {
  plan: SearchPlan;
  areas: SearchArea[];
  /** How many postings this search should have loaded; grows by BATCH_SIZE with each "more". */
  target: number;
  /** Duplicate keys already accepted or rejected, so no posting is looked at twice. */
  seen: string[];
  /** Accepted listings waiting for their full posting, best first. */
  queue: Array<Listing & { home: boolean }>;
  /** (title, area) pairs already searched. */
  searched: string[];
  loaded: number;
  /** The first add_jobs of a new search replaces the pool; later ones append. */
  started: boolean;
  skipped: Record<string, number>;
}

const read = (): Search | null => (existsSync(SEARCH_FILE) ? (JSON.parse(readFileSync(SEARCH_FILE, "utf8")) as Search) : null);
const save = (s: Search) => {
  mkdirSync(path.dirname(SEARCH_FILE), { recursive: true });
  writeFileSync(SEARCH_FILE, JSON.stringify(s, null, 2));
};
const skip = (s: Search, reason: string) => void (s.skipped[reason] = (s.skipped[reason] ?? 0) + 1);

// ── Parsing the plugin's markdown ───────────────────────────────────────────

const field = (block: string, name: string) => block.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`))?.[1]?.trim();
const usable = (v: string | undefined) => (v && !/^n\/?a$/i.test(v) ? v : undefined);

/** "September 07, 2026" → "2026-09-07". Anything else → undefined (never guess a date). */
export function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(`${value} UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : undefined;
}

function listingFrom(block: string, title: string | undefined): Listing | null {
  const indeedId = field(block, "Job Id");
  const company = field(block, "Company");
  const url = field(block, "View Job URL");
  if (!title || !indeedId || !company || !url) return null;
  return {
    indeedId,
    title,
    company,
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
    .filter((l): l is Listing => l !== null);
}

/** A get_job_details result: "### Title", the same fields, then the description. */
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

// ── The search ──────────────────────────────────────────────────────────────

export interface SearchBrief {
  target: number;
  titles: string[];
  level: SearchPlan["level"];
  postedWithinDays: number | null;
  /** Search these in order; stop once `fetch` lists enough ids. */
  areas: SearchArea[];
  homeState: string | null;
  next: string;
}

function brief(s: Search): SearchBrief {
  const days = searchDays(s.plan) ?? null;
  return {
    target: s.target,
    titles: indeedQueries(s.plan),
    level: s.plan.level,
    postedWithinDays: days,
    areas: s.areas,
    homeState: homeState(s.plan),
    next: nextStep(s),
  };
}

/** A few distinct search phrases: Indeed matches loosely, so three or four titles cover a role. */
function indeedQueries(plan: SearchPlan): string[] {
  const prefix = plan.level === "entry" ? "entry level " : plan.level === "senior" ? "senior " : "";
  return [...new Set(plan.titles.slice(0, 4).map((t) => `${prefix}${t}`.trim()))];
}

function nextStep(s: Search): string {
  const need = s.target - s.loaded - s.queue.length;
  if (s.queue.length && need <= 0) return `Fetch the ${s.queue.length} queued postings with get_job_details and pass them to add_jobs.`;
  const pending = pendingSearches(s)[0];
  if (pending) return `Search Indeed: search_jobs(search: "${pending.title}", location: "${pending.area.query}", country_code: "US"), then add_search_results.`;
  return s.queue.length
    ? `Fetch the ${s.queue.length} queued postings with get_job_details and pass them to add_jobs. The planned searches are used up.`
    : "The planned searches are used up. Try broader titles with start_search, or report what was found.";
}

function pendingSearches(s: Search): Array<{ title: string; area: SearchArea }> {
  const done = new Set(s.searched);
  // Area-major order: every title in the city before moving outward, so in-state jobs come first.
  return s.areas.flatMap((area) => indeedQueries(s.plan).map((title) => ({ title, area }))).filter((p) => !done.has(`${p.title}@${p.area.query}`));
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
  };
  save(s);
  return brief(s);
}

/** Same search, 50 more postings: continues through the remaining titles and areas, never repeating a posting. */
export function moreFromSearch(): SearchBrief {
  const s = read();
  if (!s) throw new Error("No search to continue. Start one with start_search.");
  s.target = s.loaded + BATCH_SIZE;
  save(s);
  return brief(s);
}

export interface ResultsSummary {
  parsed: number;
  accepted: number;
  skipped: Record<string, number>;
  /** Indeed job ids to fetch with get_job_details, best first. */
  fetch: string[];
  loaded: number;
  target: number;
  next: string;
}

/** Filters one search_jobs result without fetching anything. */
export function addSearchResults(raw: string, searched?: { title: string; location: string }): ResultsSummary {
  const s = read();
  if (!s) throw new Error("Start a search first (start_search).");
  const listings = parseSearchResults(raw);
  if (searched) s.searched.push(`${searched.title}@${searched.location}`);
  else {
    const first = pendingSearches(s)[0]; // assume the model searched what it was told to
    if (first) s.searched.push(`${first.title}@${first.area.query}`);
  }

  const days = searchDays(s.plan);
  const cutoff = days ? Date.now() - days * 86_400_000 : null;
  const seen = new Set(s.seen);
  const before = s.queue.length;
  for (const l of listings) {
    const key = postingKey(l);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!titleFit(l.title, s.plan)) { skip(s, "different role"); continue; }
    if (levelFit(l.title, s.plan) === null || earlyTitleMismatch(l.title, s.plan)) { skip(s, "wrong level"); continue; }
    const where = placement(l.location, s.plan);
    if (where === "no") { skip(s, "outside the area (and not remote)"); continue; }
    if (cutoff && l.postedAt && Date.parse(l.postedAt) < cutoff) { skip(s, "too old"); continue; }
    if (/internship/i.test(l.jobType ?? "") && !s.plan.internships) { skip(s, "internship"); continue; }
    s.queue.push({ ...l, home: where === "home" });
  }
  // In-state first, then explicit entry-level titles, then newest.
  s.queue.sort((a, b) => Number(b.home) - Number(a.home) || (levelFit(b.title, s.plan) ?? 0) - (levelFit(a.title, s.plan) ?? 0) || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
  s.seen = [...seen];
  save(s);

  const room = Math.max(0, s.target - s.loaded);
  return {
    parsed: listings.length,
    accepted: s.queue.length - before,
    skipped: s.skipped,
    fetch: s.queue.slice(0, room).map((l) => l.indeedId),
    loaded: s.loaded,
    target: s.target,
    next: nextStep(s),
  };
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
  done: boolean;
  next: string;
}

/** Full postings: Indeed get_job_details output, or postings the model found with its own web search. */
export function addJobs(input: { indeedDetails?: string[] | undefined; postings?: WebPosting[] | undefined }): JobsSummary {
  const s = read();
  if (!s) throw new Error("Start a search first (start_search).");
  const candidates: Array<RawJob & { home: boolean }> = [];

  const consider = (job: RawJob) => {
    const where = placement(job.location, s.plan);
    if (where === "no") return skip(s, "outside the area (and not remote)");
    const issue = jobFitIssue(job, s.plan);
    if (issue) return skip(s, issue);
    const days = searchDays(s.plan);
    if (days && job.postedAt && Date.parse(job.postedAt) < Date.now() - days * 86_400_000) return skip(s, "too old");
    candidates.push({ ...job, home: where !== "remote" });
  };

  for (const raw of input.indeedDetails ?? []) {
    const d = parseJobDetails(raw);
    if (!d) { skip(s, "unreadable job details"); continue; }
    s.queue = s.queue.filter((q) => q.indeedId !== d.indeedId);
    consider({
      id: `indeed:${createHash("sha256").update(postingKey(d)).digest("hex").slice(0, 20)}`,
      title: d.title,
      company: d.company,
      location: d.location,
      applyUrl: d.url,
      postingUrl: d.url,
      description: normalizePosting(d.description),
      ...(d.postedAt && { postedAt: d.postedAt }),
      ...(d.pay && { pay: d.pay }),
    } as RawJob);
  }
  const seen = new Set(s.seen);
  for (const p of input.postings ?? []) {
    let url: string;
    try { url = canonicalUrl(p.url); } catch { skip(s, "invalid link"); continue; }
    const job = { title: p.title, company: p.company, location: p.location ?? "", description: normalizePosting(p.description) };
    const key = postingKey(job);
    if (seen.has(key)) continue;
    seen.add(key);
    consider({ ...job, id: `web:${createHash("sha256").update(key).digest("hex").slice(0, 20)}`, applyUrl: url, postingUrl: url, ...(p.postedAt && { postedAt: p.postedAt }) });
  }
  s.seen = [...seen];

  // In-state postings first, so the first batch the app shows is the closest.
  candidates.sort((a, b) => Number(b.home) - Number(a.home));
  const { jobs } = normalizeJobs(candidates.map(({ home: _home, ...job }) => job));
  const existing = s.started && currentJobs().source === "harness" ? currentJobs().jobs : [];
  const existingKeys = new Set(existing.map(postingKey));
  const fresh = jobs.filter((j) => !existingKeys.has(postingKey(j)));
  if (fresh.length) {
    loadJobs(fresh, { replace: !s.started });
    s.started = true;
  }
  s.loaded += fresh.length;
  save(s);
  return {
    loaded: s.loaded,
    target: s.target,
    addedNow: fresh.length,
    skipped: s.skipped,
    poolSize: currentJobs().jobs.length,
    done: s.loaded >= s.target,
    next: s.loaded >= s.target ? "Done. Call open_app (the open app picks up the new postings)." : nextStep(s),
  };
}

export function searchStatus(): (SearchBrief & { loaded: number; queued: number; skipped: Record<string, number> }) | null {
  const s = read();
  return s ? { ...brief(s), loaded: s.loaded, queued: s.queue.length, skipped: s.skipped } : null;
}
