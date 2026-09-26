import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collectPublicJobs, postingKey, type SearchDiagnostics } from "./exa";
import { findJobs as findTrackedJobs, moreJobs as moreTrackedJobs, type FindSummary as TrackedSummary } from "./joboid";
import { planFromQuery, validatePlan, type SearchPlan } from "./intent";
import { currentJobs, loadJobs, type LoadSummary } from "./jobs";
import { SESSION_FILE } from "./paths";

export type Provider = "exa" | "joboid";
export interface FindOptions { keep?: boolean; provider?: Provider; maxQueries?: number; widen?: boolean }
interface Session { provider: "exa"; plans: SearchPlan[]; rounds: number[]; seen: string[] }
export interface PublicSummary extends LoadSummary, SearchDiagnostics { exhausted: false; plans: SearchPlan[] }
export type FindSummary = PublicSummary | (TrackedSummary & { provider: "joboid" });
function readSession(): Session | null {
  if (!existsSync(SESSION_FILE)) return null;
  const session = JSON.parse(readFileSync(SESSION_FILE, "utf8")) as Session;
  return session.provider === "exa" ? session : null;
}
function save(session: Session) {
  mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

function report(summary: FindSummary): FindSummary {
  mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  writeFileSync(path.join(path.dirname(SESSION_FILE), "last-search-report.json"), JSON.stringify({ recordedAt: new Date().toISOString(), ...summary }, null, 2));
  return summary;
}

/** Public web by default. Tracked-company search is explicitly opt-in. */
export async function findJobs(input: SearchPlan | string, options: FindOptions = {}): Promise<FindSummary> {
  const plan = validatePlan(typeof input === "string" ? planFromQuery(input) : input);
  const provider = options.provider ?? "exa";
  if (provider !== "exa" && provider !== "joboid") throw new Error("provider must be exa or joboid.");
  if (options.keep && existsSync(SESSION_FILE)) {
    const previousProvider = readSession() ? "exa" : "joboid";
    if (provider !== previousProvider) throw new Error("Start a new search when switching providers (omit keep).");
  }
  if (provider === "joboid") return { ...await findTrackedJobs(plan, options), provider };
  const previous = options.keep ? readSession() : null;
  const existing = options.keep && currentJobs().source === "harness" ? currentJobs().jobs : [];
  const seen = new Set([...(previous?.seen ?? []), ...existing.flatMap((j) => [j.id, postingKey(j)])]);
  const { jobs, ...diagnostics } = await collectPublicJobs(plan, { seen, ...(options.maxQueries !== undefined ? { maxQueries: options.maxQueries } : {}) });
  // An empty search preserves the useful pool, but more must continue the newly requested filters.
  const summary = jobs.length ? loadJobs(jobs, { replace: !options.keep }) : { added: 0, updated: 0, total: currentJobs().jobs.length, rejected: [], droppedStale: 0 };
  const plans = [...(previous?.plans ?? []), plan];
  save({ provider, plans, rounds: [...(previous?.rounds ?? []), diagnostics.nextRound], seen: [...seen, ...jobs.flatMap((j) => [j.id, postingKey(j)])] });
  if (!jobs.length) diagnostics.warnings.push("No new jobs loaded; the existing pool was preserved.");
  return report({ ...summary, ...diagnostics, exhausted: false, plans });
}

export async function moreJobs({ maxQueries = 5 }: { maxQueries?: number } = {}): Promise<FindSummary> {
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 6) throw new Error("maxQueries must be an integer from 1 to 6.");
  const session = readSession();
  if (!session) return { ...await moreTrackedJobs(), provider: "joboid" };
  const seen = new Set(session.seen);
  // Budget applies to the whole call, even when keep added multiple plans.
  const diagnostics: SearchDiagnostics = { provider: "exa", queries: [], examined: 0, skipped: {}, warnings: [], limited: false, nextRound: 0, areasSearched: [], matchesByArea: {} };
  const jobs = [];
  const rounds = [...session.rounds];
  const order = session.plans.map((plan, index) => ({ plan, index })).sort((a, b) => (rounds[a.index] ?? 0) - (rounds[b.index] ?? 0));
  for (const { plan, index } of order) {
    const remaining = maxQueries - diagnostics.queries.length;
    if (remaining <= 0) { diagnostics.limited = true; break; }
    const result = await collectPublicJobs(plan, { seen, round: rounds[index] ?? 0, maxQueries: remaining });
    jobs.push(...result.jobs);
    result.jobs.forEach((j) => { seen.add(j.id); seen.add(postingKey(j)); });
    rounds[index] = result.nextRound;
    diagnostics.queries.push(...result.queries); diagnostics.examined += result.examined;
    diagnostics.warnings.push(...result.warnings); diagnostics.limited ||= result.limited;
    diagnostics.nextRound = result.nextRound;
    if (result.performance) {
      diagnostics.performance ??= { elapsedMs: 0, searchMs: 0, pageFetches: 0, cacheHits: 0, prefiltered: 0 };
      for (const key of Object.keys(result.performance) as Array<keyof NonNullable<SearchDiagnostics["performance"]>>) diagnostics.performance[key] += result.performance[key];
    }
    diagnostics.areasSearched.push(...result.areasSearched);
    diagnostics.sourceCounts ??= {};
    Object.entries(result.sourceCounts ?? {}).forEach(([source, count]) => { diagnostics.sourceCounts![source] = (diagnostics.sourceCounts![source] ?? 0) + count; });
    Object.entries(result.matchesByArea).forEach(([area, count]) => { diagnostics.matchesByArea[area] = (diagnostics.matchesByArea[area] ?? 0) + count; });
    Object.entries(result.skipped).forEach(([reason, count]) => { diagnostics.skipped[reason] = (diagnostics.skipped[reason] ?? 0) + count; });
  }
  const summary = jobs.length ? loadJobs(jobs, { replace: true }) : { added: 0, updated: 0, total: currentJobs().jobs.length, rejected: [], droppedStale: 0 };
  save({ ...session, rounds, seen: [...seen] });
  if (!jobs.length) diagnostics.warnings.push("No new jobs loaded; the existing pool was preserved.");
  return report({ ...summary, ...diagnostics, warnings: [...new Set(diagnostics.warnings)], exhausted: false, plans: session.plans });
}
