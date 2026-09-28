// Company boards: every open job, at every level, from thousands of employers that hire tech people.
//
// The community lists (new-grad and internships) link to employers' own job boards: Greenhouse, Lever, Ashby,
// SmartRecruiters, Workable, Rippling and Workday. Those links are a directory of ~4,500 employers and where they hire.
// For a search, JevJob picks the boards that hire near you (or remotely), pulls their full listings from each board's
// public API (cached for 12 hours), keeps the jobs that fit the titles, level, place and dates, and reads the best
// ones in full. Unlike the new-grad list itself, this works for senior roles, IT, data, anything employers post.
//
//   directory()   boards from both lists, with where each employer has hired (cached for a day)
//   warmBoards()  start pulling listings in the background as soon as a search starts
//   addFromBoards()  the search step, called by search_career_sites
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeJobs, normalizePosting, type RawJob } from "@jevjob/core";
import { homeOf, placement, placeRank, radiusOf } from "./geography";
import { admit, ageOf, load, skip, type Search } from "./indeed";
import { levelFit, titleFit, type SearchPlan } from "./intent";
import { loadFeed, readCached } from "./new-grad-feed";
import { FEED_CACHE_DIR } from "./paths";
import { locate, miles } from "./places";
import { postingKey, plainText } from "./posting";
import { detect } from "./readers";
import { get, isoDay, post } from "./readers/http";
import { earlyTitleMismatch } from "./search-quality";

type BoardAts = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workable" | "rippling" | "workday";

export interface Board {
  ats: BoardAts;
  /** The ids its API needs, e.g. { board: "stripe" } or { host, tenant, site } for Workday. */
  parts: Record<string, string>;
  company: string;
  /** Rows in the lists pointing at this board: a rough measure of how much it hires. */
  rows: number;
  /** Where it has hired: states, a few coordinates, and whether any posting was remote. */
  states: string[];
  points: Array<[number, number]>;
  remote: boolean;
}

export interface BoardListing {
  title: string;
  location: string;
  postedAt?: string | undefined;
  url: string;
  /** Lever and Ashby include the full text in their listings, so those need no second request. */
  description?: string | undefined;
}

const LISTING_TTL_MS = 12 * 3_600_000;
const DIRECTORY_TTL_MS = 24 * 3_600_000;
/** Boards pulled per search, best first (the rest are the long tail far from you). */
const MAX_BOARDS = 450;
const MAX_WORKDAY_BOARDS = 120;
const CONCURRENCY = 24;
/** A search step waits at most this long for listings; boards still loading finish in the background for next time. */
const BUDGET_MS = 40_000;
const MAX_READS = 100;
const BATCH = 16; // small batches, so the time budget is checked often
const UNKNOWN_PER_EMPLOYER = 2;
/** A batch of reads can take one request timeout (12 s); don't start one this close to the deadline. */
export const START_BY_MS = 10_000;

const keyOf = (b: Pick<Board, "ats" | "parts">) => `${b.ats}:${Object.values(b.parts).join("/")}`.toLowerCase();
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const cacheDir = path.join(FEED_CACHE_DIR, "boards");

// ── The directory ───────────────────────────────────────────────────────────

let directoryMemo: Promise<Board[]> | null = null;

/**
 * Every listable board the community lists point at, with where each employer has hired. One build at a time: the
 * background warm-up at start_search and the search step share it.
 */
export function directory(): Promise<Board[]> {
  directoryMemo ??= buildDirectory().catch((err) => {
    directoryMemo = null; // let the next call retry
    throw err;
  });
  return directoryMemo;
}

async function buildDirectory(): Promise<Board[]> {
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, "directory.json");
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < DIRECTORY_TTL_MS) {
    return JSON.parse(readFileSync(file, "utf8")) as Board[];
  }
  const rows = (await Promise.all((["new-grad", "internships"] as const).map((name) => loadFeed(name).catch(() => [])))).flat();
  const boards = new Map<string, Board & { stateSet: Set<string> }>();
  for (const row of rows) {
    const target = row.url ? detect(row.url) : null;
    if (!target) continue;
    const parts = boardParts(target.ats, target.parts);
    if (!parts) continue;
    const key = keyOf({ ats: target.ats as BoardAts, parts });
    const board = boards.get(key) ?? { ats: target.ats as BoardAts, parts, company: row.company_name, rows: 0, states: [], points: [], remote: false, stateSet: new Set<string>() };
    board.rows++;
    const where = (row.locations ?? []).join("; ");
    if (/remote/i.test(where)) board.remote = true;
    for (const spot of locate(where)) {
      if (spot.state) board.stateSet.add(spot.state);
      if (spot.place && board.points.length < 12 && !board.points.some(([la, lo]) => Math.abs(la - spot.place!.lat) < 0.2 && Math.abs(lo - spot.place!.lon) < 0.2)) {
        board.points.push([spot.place.lat, spot.place.lon]);
      }
    }
    boards.set(key, board);
  }
  const list = [...boards.values()].map(({ stateSet, ...b }) => ({ ...b, states: [...stateSet] }));
  writeFileSync(file, JSON.stringify(list));
  return list;
}

/** The board-level ids from a posting URL's parts; null for systems without a list API. */
function boardParts(ats: string, parts: Record<string, string>): Record<string, string> | null {
  switch (ats) {
    case "greenhouse": case "ashby": case "smartrecruiters": case "workable": case "rippling":
      return { board: parts.board! };
    case "lever":
      return { eu: parts.eu ?? "", board: parts.board! };
    case "workday":
      return { host: parts.host!, tenant: parts.tenant!, site: parts.site! };
    default:
      return null;
  }
}

// ── Which boards a search pulls ─────────────────────────────────────────────

/** 3: hires near the search, 2: in its state, 1: remote, 0: elsewhere (skipped). Plans with no place take every board. */
export function boardScore(board: Pick<Board, "states" | "points" | "remote">, plan: SearchPlan): number {
  if (!plan.locations.length) return plan.remote ? (board.remote ? 1 : 0) : 1;
  const home = homeOf(plan);
  if (!home) return board.remote ? 1 : 0;
  if (home.kind === "state") return board.states.includes(home.state) ? 3 : board.remote ? 1 : 0;
  const reach = radiusOf(plan) + 15; // a board's known locations are a sample; allow a little slack
  if (board.points.some(([lat, lon]) => miles({ lat, lon }, home.place) <= reach)) return 3;
  if (plan.locationMode === "strict") return 0;
  if (board.states.includes(home.place.state)) return 2;
  return board.remote ? 1 : 0;
}

export async function boardsFor(plan: SearchPlan): Promise<Board[]> {
  const scored = (await directory()).map((b) => ({ b, score: boardScore(b, plan) })).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || b.b.rows - a.b.rows);
  const workday = scored.filter((x) => x.b.ats === "workday").slice(0, MAX_WORKDAY_BOARDS);
  const rest = scored.filter((x) => x.b.ats !== "workday").slice(0, MAX_BOARDS);
  return [...rest, ...workday].map((x) => x.b);
}

// ── Pulling listings ────────────────────────────────────────────────────────

type Json = Record<string, any>; // untrusted API JSON, read defensively

/** Workday searches server-side, so its listings are per query: the plan's first title (e.g. "software engineer"). */
const workdayQuery = (plan: SearchPlan) => plan.titles[0] ?? "";

async function fetchListings(board: Board, plan: SearchPlan): Promise<BoardListing[]> {
  const p = board.parts;
  switch (board.ats) {
    case "greenhouse": {
      const d = await get<Json>(`https://boards-api.greenhouse.io/v1/boards/${p.board}/jobs`);
      return (d.jobs ?? []).map((j: Json) => ({ title: j.title ?? "", location: j.location?.name ?? "", postedAt: isoDay(j.first_published ?? j.updated_at), url: j.absolute_url }));
    }
    case "lever": {
      const d = await get<Json[]>(`https://api.${p.eu ? "eu." : ""}lever.co/v0/postings/${p.board}?mode=json`);
      return d.map((j) => ({
        title: j.text ?? "",
        location: j.categories?.location ?? (j.categories?.allLocations ?? []).join("; "),
        postedAt: isoDay(j.createdAt),
        url: j.hostedUrl,
        description: [j.descriptionPlain, ...(j.lists ?? []).map((l: Json) => `${l.text ?? ""}\n${plainText(l.content ?? "")}`), j.additionalPlain].filter(Boolean).join("\n\n"),
      }));
    }
    case "ashby": {
      const d = await get<Json>(`https://api.ashbyhq.com/posting-api/job-board/${p.board}`);
      return (d.jobs ?? []).filter((j: Json) => j.isListed !== false).map((j: Json) => ({
        title: j.title ?? "",
        location: [j.location, ...(j.secondaryLocations ?? []).map((s: Json) => s.location)].filter(Boolean).join("; ") + (j.workplaceType === "Remote" ? " (Remote)" : ""),
        postedAt: isoDay(j.publishedAt),
        url: j.jobUrl,
        description: j.descriptionPlain ?? plainText(j.descriptionHtml ?? ""),
      }));
    }
    case "smartrecruiters": {
      const d = await get<Json>(`https://api.smartrecruiters.com/v1/companies/${p.board}/postings?limit=100`);
      return (d.content ?? []).map((j: Json) => ({
        title: j.name ?? "",
        location: j.location?.fullLocation ?? [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", ") + (j.location?.remote ? " (Remote)" : ""),
        postedAt: isoDay(j.releasedDate),
        url: `https://jobs.smartrecruiters.com/${p.board}/${j.id}`,
      }));
    }
    case "workable": {
      const d = await get<Json>(`https://apply.workable.com/api/v1/widget/accounts/${p.board}`);
      return (d.jobs ?? []).map((j: Json) => ({
        title: j.title ?? "",
        location: [j.city, j.state, j.country].filter(Boolean).join(", ") + (j.telecommuting ? " (Remote)" : ""),
        postedAt: isoDay(j.published_on ?? j.created_at),
        url: j.url ?? `https://apply.workable.com/${p.board}/j/${j.shortcode}/`,
      }));
    }
    case "rippling": {
      const d = await get<Json>(`https://ats.rippling.com/api/v2/board/${p.board}/jobs`);
      return (d.items ?? []).map((j: Json) => ({ title: j.name ?? "", location: (j.locations ?? []).map((l: Json) => l.name).join("; "), url: j.url }));
    }
    case "workday": {
      const d = await post<Json>(`https://${p.host}/wday/cxs/${p.tenant}/${p.site}/jobs`, { appliedFacets: {}, limit: 20, offset: 0, searchText: workdayQuery(plan) });
      const root = p.host!.endsWith("myworkdaysite.com") ? `https://${p.host}/recruiting/${p.tenant}/${p.site}` : `https://${p.host}/${p.site}`;
      return (d.jobPostings ?? []).filter((j: Json) => j.externalPath).map((j: Json) => ({
        title: j.title ?? "",
        location: j.locationsText ?? "",
        postedAt: workdayPosted(j.postedOn),
        url: `${root}${j.externalPath}`,
      }));
    }
  }
}

/** "Posted Today" / "Posted Yesterday" / "Posted 5 Days Ago" → a date. "30+ Days Ago" is only a bound: undated. */
export function workdayPosted(text: string | undefined, now = Date.now()): string | undefined {
  const t = (text ?? "").toLowerCase();
  const days = /today/.test(t) ? 0 : /yesterday/.test(t) ? 1 : /\+/.test(t) ? null : Number(t.match(/(\d+)\s*day/)?.[1] ?? NaN);
  return days === null || Number.isNaN(days) ? undefined : new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

/** A board's listings from the cache, or fetched (and cached) now. Never throws: a dead board is just empty. */
async function listings(board: Board, plan: SearchPlan): Promise<BoardListing[]> {
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${hash(board.ats === "workday" ? `${keyOf(board)}?${workdayQuery(plan)}` : keyOf(board))}.json`);
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < LISTING_TTL_MS) return JSON.parse(readFileSync(file, "utf8")) as BoardListing[];
  let items: BoardListing[] = [];
  try {
    items = (await fetchListings(board, plan)).filter((l) => l.url && l.title);
  } catch {
    // Moved, renamed or rate-limited: cache the empty result so it isn't retried on every search.
  }
  writeFileSync(file, JSON.stringify(items));
  return items;
}

/** Pulls listings for many boards with a concurrency cap. Resolves at the deadline with whatever has arrived. */
async function pullAll(boards: Board[], plan: SearchPlan, budgetMs: number): Promise<Array<{ board: Board; items: BoardListing[] }>> {
  const done: Array<{ board: Board; items: BoardListing[] }> = [];
  let next = 0;
  const worker = async () => {
    while (next < boards.length) {
      const board = boards[next++]!;
      done.push({ board, items: await listings(board, plan) });
    }
  };
  const all = Promise.all(Array.from({ length: Math.min(CONCURRENCY, boards.length) }, worker));
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([all, new Promise((r) => { timer = setTimeout(r, budgetMs); timer.unref(); })]);
  clearTimeout(timer); // the deadline alone never keeps a process alive
  return [...done];
}

/** Starts pulling a search's boards in the background (fire and forget), so the cache is warm when it's needed. */
export function warmBoards(plan: SearchPlan): void {
  void boardsFor(plan).then((boards) => pullAll(boards, plan, 10 * 60_000)).catch(() => {});
}

// ── The search step ─────────────────────────────────────────────────────────

export interface BoardsStep {
  /** Boards pulled for this search, and how many jobs they listed in total. */
  boards: number;
  listed: number;
  /** Listings that fit the search before reading; postings read in full; postings added. */
  matched: number;
  read: number;
  added: number;
  /** false when the time budget ran out with boards or postings left: another pass can continue. */
  finished?: boolean;
}

interface Candidate { listing: BoardListing; company: string; score: number[] }

/** Listings that fit, best first: in the window, nearest, explicit level fit, newest. Pure over its inputs. */
export function boardCandidates(s: Search, pulled: Array<{ board: Board; items: BoardListing[] }>): Candidate[] {
  const seen = new Set(s.seen);
  const out: Candidate[] = [];
  for (const { board, items } of pulled) {
    for (const l of items) {
      if (seen.has(postingKey({ company: board.company, title: l.title, location: l.location }))) continue;
      if (!titleFit(l.title, s.plan) || earlyTitleMismatch(l.title, s.plan)) continue;
      const level = levelFit(l.title, s.plan);
      if (level === null) continue;
      const where = placement(l.location, s.plan);
      if (where === "no") continue;
      const age = ageOf(s, l.postedAt);
      if (age === "old") continue;
      out.push({ listing: l, company: board.company, score: [age === "in" ? 1 : 0, placeRank(where), level, Date.parse(l.postedAt ?? "1970-01-01")] });
    }
  }
  out.sort((a, b) => { for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return b.score[i]! - a.score[i]!; return 0; });
  // Listings with no stated place ("3 Locations") are read to find out, but only a couple per employer.
  const unknown = new Map<string, number>();
  return out.filter((c) => {
    if (c.score[1]! > 0) return true;
    const n = (unknown.get(c.company) ?? 0) + 1;
    unknown.set(c.company, n);
    return n <= UNKNOWN_PER_EMPLOYER;
  });
}

export async function addFromBoards(s: Search, deadline = Date.now() + BUDGET_MS + 60_000): Promise<BoardsStep> {
  const boards = await boardsFor(s.plan).catch(() => [] as Board[]);
  if (!boards.length) return { boards: 0, listed: 0, matched: 0, read: 0, added: 0 };
  // Leave a third of the remaining time for reading postings.
  const pulled = await pullAll(boards, s.plan, Math.max(3_000, Math.min(BUDGET_MS, (deadline - Date.now()) * 0.65)));
  const candidates = boardCandidates(s, pulled);
  const seen = new Set(s.seen);
  let read = 0;
  let added = 0;
  const want = () => s.target - s.loaded - s.queue.length;
  for (let i = 0; i < candidates.length && read < MAX_READS && want() > 0 && Date.now() < deadline - START_BY_MS; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const needsReading = batch.filter((c) => !c.listing.description);
    const results = new Map((await readCached(needsReading.map((c) => ({ url: c.listing.url })))).map((r) => [r.url, r]));
    read += batch.length;
    const raw: RawJob[] = [];
    for (const c of batch) {
      seen.add(postingKey({ company: c.company, title: c.listing.title, location: c.listing.location }));
      let description = c.listing.description;
      let { location, postedAt } = c.listing;
      let url = c.listing.url;
      let applyUrl = url;
      if (!description) {
        const r = results.get(c.listing.url);
        if (!r?.ok) {
          skip(s, r && !r.ok && r.closed ? "closed" : "unreadable posting");
          continue;
        }
        description = r.posting.description;
        location = r.posting.location || location;
        postedAt = r.posting.postedAt ?? postedAt;
        url = r.posting.postingUrl || url;
        applyUrl = r.posting.applyUrl || url;
      }
      raw.push({
        id: `board:${hash(c.listing.url).slice(0, 20)}`,
        company: c.company,
        title: c.listing.title,
        location,
        applyUrl,
        postingUrl: url,
        description: normalizePosting(description),
        ...(postedAt && { postedAt }),
      });
    }
    s.seen = [...seen];
    const { jobs } = normalizeJobs(raw);
    const admitted = jobs.flatMap((job) => admit(s, job, { requirePlace: true }) ?? []);
    added += load(s, admitted.slice(0, Math.max(0, s.target - s.loaded)));
  }
  const finished = pulled.length === boards.length && (want() <= 0 || read >= Math.min(MAX_READS, candidates.length));
  return { boards: pulled.length, listed: pulled.reduce((n, p) => n + p.items.length, 0), matched: candidates.length, read, added, finished };
}
