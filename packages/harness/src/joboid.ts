// Pulls fresh postings from Joboid (company career sites, not LinkedIn/Indeed) without spending any LLM tokens:
// `joboid search` finds matches, `joboid job <id>` fetches each full description.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { joboidDir } from "./paths";
import { loadJobs, type LoadSummary } from "./jobs";

const run = promisify(execFile);

export interface JoboidQuery {
  query: string;
  location?: string | undefined;
  remote?: boolean | undefined;
  /** Only postings from the last N days. */
  days?: number | undefined;
  limit?: number | undefined;
  /** Merge into the current pool instead of replacing it. */
  keep?: boolean | undefined;
}

async function joboid(dir: string, args: string[]): Promise<unknown> {
  const { stdout } = await run("uv", ["run", "joboid", ...args], { cwd: dir, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  return JSON.parse(stdout);
}

export async function importFromJoboid(q: JoboidQuery): Promise<LoadSummary & { searched: number }> {
  const dir = joboidDir();
  if (!dir) throw new Error("Joboid not found. Set JOBOID_DIR to your Joboid folder.");

  const args = ["search", q.query, "--limit", String(q.limit ?? 20)];
  if (q.location) args.push("--location", q.location);
  if (q.remote) args.push("--remote");
  if (q.days) args.push("--days", String(q.days));
  const found = (await joboid(dir, args)) as { jobs?: Array<{ id: string }> };
  const ids = (found.jobs ?? []).map((j) => j.id);

  // Descriptions come one job at a time; a few in parallel keeps it quick without hammering career sites.
  const full: unknown[] = [];
  for (let i = 0; i < ids.length; i += 4) {
    const batch = await Promise.all(ids.slice(i, i + 4).map((id) => joboid(dir, ["job", id]).catch(() => null)));
    full.push(...batch.filter(Boolean));
  }

  return { ...loadJobs(full, { replace: !q.keep, maxAgeDays: q.days }), searched: ids.length };
}
