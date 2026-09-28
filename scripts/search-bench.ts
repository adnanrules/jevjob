// npm run bench:search: runs a fixed set of searches the way a new user would (no Indeed, no Joboid) and reports what
// each one finds. Live network, so numbers drift day to day; use it to compare changes to search, not as a score.
//   npm run bench:search             all queries
//   npm run bench:search -- nyc      only queries whose label contains "nyc"
// Each query runs in its own process with its own scratch pool, so they can't affect each other or your real pool.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUERIES: Record<string, string> = {
  "chicago-junior-swe": "junior software engineer in Chicago, last 30 days",
  "austin-entry-data": "entry level data analyst in Austin, last 30 days",
  "remote-newgrad-ml": "new grad machine learning engineer remote, last 30 days",
  "seattle-swe-any": "software engineer in Seattle, last 30 days",
  "nyc-senior-backend": "senior backend engineer in NYC, last 30 days",
  "denver-it-support": "it support in Denver, last 30 days",
  "raleigh-data-eng": "data engineer in Raleigh, NC, last 30 days",
};

interface Result { label: string; loaded: number; inWindow: number; where: Record<string, number>; sources: Record<string, number>; seconds: number; skips: string; boards: unknown; titles: string[] }

async function runOne(label: string): Promise<Result> {
  const { planFromQuery } = await import("../packages/harness/src/intent");
  const { startSearch } = await import("../packages/harness/src/indeed");
  const { searchCareerSites } = await import("../packages/harness/src/career-sites");
  const { currentJobs } = await import("../packages/harness/src/jobs");
  const { placement } = await import("../packages/harness/src/geography");
  const plan = { ...planFromQuery(QUERIES[label]!), count: 50 };
  startSearch(plan);
  (await import("../packages/harness/src/boards")).warmBoards(plan); // as start_search does over MCP
  const t = Date.now();
  // As an assistant would: call again while it says it stopped at its time limit.
  const timed = async () => { const s0 = Date.now(); const out = await searchCareerSites(); longest = Math.max(longest, Date.now() - s0); return out; };
  let longest = 0;
  let r = await timed();
  let passes = 1;
  while (r.next.includes("search_career_sites again") && passes < 3) {
    r = await timed();
    passes++;
  }
  const jobs = currentJobs().jobs;
  const where: Record<string, number> = {};
  const sources: Record<string, number> = {};
  for (const j of jobs) {
    const p = placement(j.location, plan);
    where[p] = (where[p] ?? 0) + 1;
    const src = j.id.split(":")[0]!;
    sources[src] = (sources[src] ?? 0) + 1;
  }
  const skips = Object.entries(r.skipped).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ");
  return { label, loaded: jobs.length, inWindow: jobs.filter((j) => !j.outsideWindowDays).length, where, sources, seconds: Math.round((Date.now() - t) / 1000), skips, boards: { ...r.boards, passes, longestCallS: Math.round(longest / 1000) }, titles: plan.titles };
}

if (process.env.BENCH_ONE) {
  console.log(JSON.stringify(await runOne(process.env.BENCH_ONE)));
  process.exit(0); // don't wait for background board pulls (warmBoards) to finish
} else {
  const self = fileURLToPath(import.meta.url);
  const tsx = path.resolve(path.dirname(self), "../node_modules/tsx/dist/cli.mjs");
  const only = process.argv[2]?.toLowerCase();
  const results: Result[] = [];
  // One cache for the whole run (the first query pays for downloads), as it would be for a real user after one search.
  const cache = process.env.JEVJOB_CACHE_DIR || mkdtempSync(path.join(tmpdir(), "bench-cache-"));
  for (const label of Object.keys(QUERIES).filter((l) => !only || l.includes(only))) {
    const env = { ...process.env, BENCH_ONE: label, JEVJOB_DATA_DIR: mkdtempSync(path.join(tmpdir(), `bench-${label}-`)), JOBOID_DIR: path.join(tmpdir(), "no-joboid"), JEVJOB_CACHE_DIR: cache };
    const out = execFileSync(process.execPath, [tsx, self], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const r = JSON.parse(out.trim().split("\n").at(-1)!) as Result;
    results.push(r);
    console.log(`${r.label}: ${r.loaded} loaded (${r.inWindow} in window) · near ${r.where.near ?? 0} · state ${r.where.state ?? 0} · remote ${r.where.remote ?? 0} · ${r.seconds}s · ${JSON.stringify(r.sources)} · boards ${JSON.stringify(r.boards)} · titles ${r.titles.slice(0, 4).join("/")}`);
  }
  console.log("\n| query | loaded | in window | near | state | remote | sources | time | top skips |\n|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.label} | ${r.loaded} | ${r.inWindow} | ${r.where.near ?? 0} | ${r.where.state ?? 0} | ${r.where.remote ?? 0} | ${Object.entries(r.sources).map(([k, v]) => `${k} ${v}`).join(", ")} | ${r.seconds}s | ${r.skips} |`);
  }
}
