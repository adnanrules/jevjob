// Pulls fresh postings from Joboid (company career sites, not LinkedIn/Indeed) without spending LLM tokens.
// `joboid search` finds candidates (newest first); `joboid job <id>` fetches each full posting.
//
// A search session (.jevjob/session.json) remembers the searches behind the current pool and every posting
// already shown, so `more` can rerun the exact same searches and return only postings you haven't seen.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeJobs, type RawJob } from "@jevjob/core";
import { joboidDir, SESSION_FILE } from "./paths";
import { loadJobs, type LoadSummary } from "./jobs";

const run = promisify(execFile);

/** How recently a posting went up. Maps the command's shorthand to days. */
export const POSTED_WINDOWS = { "24h": 1, "7d": 7, "30d": 30, "3month": 90 } as const;
export type PostedWindow = keyof typeof POSTED_WINDOWS;

export interface JoboidQuery {
  query: string;
  location?: string | undefined;
  remote?: boolean | undefined;
  /** Only postings from within this window, judged by each posting's own date. */
  posted?: PostedWindow | undefined;
  /** How many postings this search should add to the pool. */
  limit?: number | undefined;
  /** Add to the current pool (a second search in the same session) instead of starting a new one. */
  keep?: boolean | undefined;
}

type SavedSearch = Omit<JoboidQuery, "keep"> & { limit: number };

interface Session {
  searches: SavedSearch[];
  /** Every posting id shown in this session, so "more" never repeats one. */
  seen: string[];
}

export interface ImportSummary extends LoadSummary {
  /** Postings examined, including ones skipped as seen, closed, too old or unreadable. */
  examined: number;
  /** True when Joboid ran out of matching postings before reaching the limit. */
  exhausted: boolean;
}

const readSession = (): Session | null => (existsSync(SESSION_FILE) ? (JSON.parse(readFileSync(SESSION_FILE, "utf8")) as Session) : null);
const writeSession = (s: Session) => {
  mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2));
};

async function joboid(dir: string, args: string[]): Promise<unknown> {
  const { stdout } = await run("uv", ["run", "joboid", ...args], { cwd: dir, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return JSON.parse(stdout);
}

/**
 * Collects up to `search.limit` new, open, in-window postings. Joboid's own date filter keeps postings whose
 * date it doesn't know yet (most Workday listings), so the window is enforced here, on each full posting's date:
 * ask for extra candidates, then fetch full postings until enough pass.
 */
async function collect(dir: string, search: SavedSearch, exclude: Set<string>): Promise<{ jobs: RawJob[]; examined: number; exhausted: boolean }> {
  const days = search.posted ? POSTED_WINDOWS[search.posted] : undefined;
  const oversample = days ? 4 : 1.5;
  const want = search.limit;
  // Joboid refreshes career sites itself, skipping any it read in the last 12 hours.
  const args = ["search", search.query, "--limit", String(Math.min(1000, exclude.size + Math.ceil(want * oversample) + 10))];
  if (search.location) args.push("--location", search.location);
  if (search.remote) args.push("--remote");
  if (days) args.push("--days", String(days));

  const found = (await joboid(dir, args)) as { jobs?: Array<{ id: string }> };
  const candidates = (found.jobs ?? []).map((j) => j.id).filter((id) => !exclude.has(id));
  const cutoff = days ? Date.now() - days * 86_400_000 : null;

  const jobs: RawJob[] = [];
  let examined = 0;
  for (let i = 0; i < candidates.length && jobs.length < want; i += 6) {
    const batch = candidates.slice(i, i + 6);
    const full = await Promise.all(batch.map((id) => joboid(dir, ["job", id]).catch(() => null)));
    examined += batch.length;
    for (const job of normalizeJobs(full.filter(Boolean)).jobs) {
      if (cutoff && (!job.postedAt || Date.parse(job.postedAt) < cutoff)) continue; // undated can't prove it's recent
      if (jobs.length < want) jobs.push(job);
    }
  }
  return { jobs, examined, exhausted: examined >= candidates.length && jobs.length < want };
}

export async function importFromJoboid(q: JoboidQuery): Promise<ImportSummary> {
  const dir = joboidDir();
  if (!dir) throw new Error("Joboid not found. Set JOBOID_DIR to your Joboid folder.");
  const search: SavedSearch = { query: q.query, location: q.location, remote: q.remote, posted: q.posted, limit: q.limit ?? 25 };
  const previous = q.keep ? readSession() : null;

  const { jobs, examined, exhausted } = await collect(dir, search, new Set(previous?.seen ?? []));
  const summary = loadJobs(jobs, { replace: !q.keep });
  writeSession({ searches: [...(previous?.searches ?? []), search], seen: [...(previous?.seen ?? []), ...jobs.map((j) => j.id)] });
  return { ...summary, examined, exhausted };
}

/** Same searches, same parameters, only postings not shown yet in this session. Replaces the pool. */
export async function moreFromJoboid(): Promise<ImportSummary & { searches: SavedSearch[] }> {
  const dir = joboidDir();
  if (!dir) throw new Error("Joboid not found. Set JOBOID_DIR to your Joboid folder.");
  const session = readSession();
  if (!session?.searches.length) throw new Error("No Joboid search to continue. Run a search first.");

  const seen = new Set(session.seen);
  const fresh: RawJob[] = [];
  let examined = 0;
  let exhausted = true;
  for (const search of session.searches) {
    const result = await collect(dir, search, seen);
    for (const job of result.jobs) seen.add(job.id);
    fresh.push(...result.jobs);
    examined += result.examined;
    exhausted &&= result.exhausted;
  }

  if (fresh.length === 0) return { ...loadJobs([], { replace: false }), examined, exhausted: true, searches: session.searches };
  const summary = loadJobs(fresh, { replace: true });
  writeSession({ searches: session.searches, seen: [...seen] });
  return { ...summary, examined, exhausted, searches: session.searches };
}
