// Finds postings for a search plan using Joboid (company career sites, not LinkedIn/Indeed). No LLM tokens.
//
//   1. Joboid title search across every tracked company, all titles in the plan at once.
//   2. Rank candidates without fetching anything: level fit from the title, location fit, freshness.
//   3. Fetch full postings best-first, and keep the ones that really fit: location on the full posting,
//      posted date inside the window, and for entry level, no 3+ years requirement.
//   4. Too few? Discover more companies (web search for their job boards), then search again.
//
// A session (.jevjob/session.json) keeps the plans behind the current pool and every posting shown, so
// `more` reruns the same plans and returns only postings you haven't seen.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { extractRequirements, normalizeJobs, type RawJob } from "@jevjob/core";
import { levelFit, locationFit, POSTED_WINDOWS, type SearchPlan } from "./intent";
import { currentJobs, loadJobs, type LoadSummary } from "./jobs";
import { joboidDir, loadEnv, SESSION_FILE } from "./paths";

const run = promisify(execFile);

interface Session {
  plans: SearchPlan[];
  /** Every posting id shown in this session, so "more" never repeats one. */
  seen: string[];
}

export interface FindSummary extends LoadSummary {
  /** Candidates whose full posting was fetched and checked. */
  examined: number;
  /** New companies Joboid discovered for this search (they stay tracked for future searches). */
  companiesAdded: string[];
  /** True when there were no more matching postings to check. */
  exhausted: boolean;
}

interface Candidate {
  id: string;
  title: string;
  location: string | null;
  posted: string | null;
}

const readSession = (): Session | null => {
  if (!existsSync(SESSION_FILE)) return null;
  const s = JSON.parse(readFileSync(SESSION_FILE, "utf8")) as Partial<Session>;
  return Array.isArray(s.plans) ? (s as Session) : null; // sessions from before plans existed can't be continued
};
const writeSession = (s: Session) => {
  mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2));
};

async function joboid(dir: string, args: string[]): Promise<unknown> {
  // JevJob's .env can hold EXA_API_KEY too; Joboid inherits it from this process's environment.
  loadEnv();
  const { stdout } = await run("uv", ["run", "joboid", ...args], { cwd: dir, maxBuffer: 128 * 1024 * 1024, windowsHide: true });
  return JSON.parse(stdout);
}

const MIN_YEARS_FOR_ENTRY = 3;

/** Required years of experience in a posting, or null if it doesn't say. */
function requiredYears(job: RawJob): number | null {
  const years = extractRequirements(job).flatMap((r) => (r.kind === "experience" && r.importance === "required" ? [r.minYears] : []));
  return years.length ? Math.max(...years) : null;
}

async function candidatesFor(dir: string, plan: SearchPlan, exclude: Set<string>): Promise<Candidate[]> {
  const days = plan.posted ? POSTED_WINDOWS[plan.posted] : undefined;
  const args = ["search", "--title", plan.titles.join("|"), "--limit", "5000"];
  if (days) args.push("--days", String(days));
  const found = (await joboid(dir, args)) as { jobs?: Array<{ id: string; title: string; location?: string; posted?: string }> };

  const scored = (found.jobs ?? []).flatMap((j) => {
    if (exclude.has(j.id)) return [];
    const level = levelFit(j.title, plan);
    const where = locationFit(j.location, plan);
    if (level === null || where === "no") return [];
    const date = /^\d{4}-\d{2}-\d{2}/.test(j.posted ?? "") ? j.posted! : null;
    return [{ c: { id: j.id, title: j.title, location: j.location ?? null, posted: date }, level, sure: where === "match" ? 1 : 0 }];
  });
  // Best fit first: explicit entry-level titles, then known locations, then the freshest.
  scored.sort((a, b) => b.level - a.level || b.sure - a.sure || (b.c.posted ?? "").localeCompare(a.c.posted ?? ""));
  return scored.map((s) => s.c);
}

async function collect(dir: string, plan: SearchPlan, exclude: Set<string>, want: number) {
  const days = plan.posted ? POSTED_WINDOWS[plan.posted] : undefined;
  const cutoff = days ? Date.now() - days * 86_400_000 : null;
  const candidates = await candidatesFor(dir, plan, exclude);

  const jobs: RawJob[] = [];
  let examined = 0;
  for (let i = 0; i < candidates.length && jobs.length < want; i += 8) {
    const batch = candidates.slice(i, i + 8);
    const full = await Promise.all(batch.map((c) => joboid(dir, ["job", c.id]).catch(() => null)));
    examined += batch.length;
    for (const job of normalizeJobs(full.filter(Boolean)).jobs) {
      if (locationFit(job.location, plan) !== "match") continue; // the full posting settles placeholder locations
      if (cutoff && (!job.postedAt || Date.parse(job.postedAt) < cutoff)) continue; // undated can't prove it's recent
      if (plan.level === "entry" && (requiredYears(job) ?? 0) >= MIN_YEARS_FOR_ENTRY) continue;
      if (jobs.length < want) jobs.push(job);
    }
  }
  return { jobs, examined, exhausted: examined >= candidates.length && jobs.length < want };
}

async function discover(dir: string, plan: SearchPlan): Promise<string[]> {
  const where = plan.locations[0] ?? (plan.remote ? "remote" : "");
  const level = plan.level === "entry" ? "entry level" : plan.level === "senior" ? "senior" : "";
  const days = plan.posted ? POSTED_WINDOWS[plan.posted] : 30;
  const added = new Set<string>();
  for (const title of plan.titles.slice(0, 2)) {
    const result = (await joboid(dir, ["discover", `${level} ${title} ${where}`.trim(), "--num", "30", "--days", String(Math.max(days, 7))]).catch(
      () => null,
    )) as { companies_added?: string[] } | null;
    for (const slug of result?.companies_added ?? []) added.add(slug);
  }
  return [...added];
}

/** Runs a plan: starts a new session (replacing the pool) unless `keep`, in which case it adds to the current one. */
export async function findJobs(plan: SearchPlan, { keep = false, widen = true }: { keep?: boolean; widen?: boolean } = {}): Promise<FindSummary> {
  const dir = joboidDir();
  if (!dir) throw new Error("Joboid not found. Set JOBOID_DIR to your Joboid folder.");
  const previous = keep ? readSession() : null;
  const seen = new Set(previous?.seen ?? []);

  let { jobs, examined, exhausted } = await collect(dir, plan, seen, plan.count);
  let companiesAdded: string[] = [];
  if (widen && jobs.length < plan.count) {
    companiesAdded = await discover(dir, plan);
    if (companiesAdded.length) {
      for (const j of jobs) seen.add(j.id);
      const more = await collect(dir, plan, seen, plan.count - jobs.length);
      jobs = [...jobs, ...more.jobs];
      examined += more.examined;
      exhausted = more.exhausted;
    }
  }

  const summary = loadJobs(jobs, { replace: !keep });
  writeSession({ plans: [...(previous?.plans ?? []), plan], seen: [...(previous?.seen ?? []), ...jobs.map((j) => j.id)] });
  return { ...summary, examined, companiesAdded, exhausted };
}

/** Same plans, only postings not shown yet in this session. Replaces the pool. */
export async function moreJobs(): Promise<FindSummary & { plans: SearchPlan[] }> {
  const dir = joboidDir();
  if (!dir) throw new Error("Joboid not found. Set JOBOID_DIR to your Joboid folder.");
  const session = readSession();
  if (!session?.plans.length) throw new Error("No search to continue. Run a search first.");

  const seen = new Set(session.seen);
  const fresh: RawJob[] = [];
  let examined = 0;
  let exhausted = true;
  for (const plan of session.plans) {
    const result = await collect(dir, plan, seen, plan.count);
    for (const job of result.jobs) seen.add(job.id);
    fresh.push(...result.jobs);
    examined += result.examined;
    exhausted &&= result.exhausted;
  }
  if (fresh.length === 0) return { added: 0, updated: 0, total: currentJobs().jobs.length, droppedStale: 0, rejected: [], examined, companiesAdded: [], exhausted: true, plans: session.plans };

  const summary = loadJobs(fresh, { replace: true });
  writeSession({ plans: session.plans, seen: [...seen] });
  return { ...summary, examined, companiesAdded: [], exhausted, plans: session.plans };
}
