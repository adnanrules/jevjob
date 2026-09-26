// The job pool: what a harness loaded, or the fictional demo postings when it hasn't loaded anything.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dropStale, normalizeJobs, type IngestResult, type RawJob } from "@jevjob/core";
import { fromRoot, JOBS_FILE } from "./paths";

export type JobSource = "harness" | "demo";

const DEMO_FILES = ["fixtures/jobs.json", "packages/eval/dataset/jobs.json", "packages/eval/dataset/heldout/jobs.json"];
const readJson = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;

export function currentJobs(): { source: JobSource; jobs: RawJob[] } {
  if (existsSync(JOBS_FILE)) return { source: "harness", jobs: readJson<RawJob[]>(JOBS_FILE) };
  return { source: "demo", jobs: DEMO_FILES.flatMap((f) => readJson<RawJob[]>(fromRoot(f))) };
}

export interface LoadOptions {
  /** true: the new batch replaces the pool. false: it's merged in, newer copies winning by id. */
  replace?: boolean;
  /**
   * Only when asked: drop postings older than this many days. Off by default, because age isn't staleness:
   * closed postings are already rejected at ingestion, and many older postings are still open.
   */
  maxAgeDays?: number | undefined;
}

export interface LoadSummary {
  added: number;
  updated: number;
  total: number;
  droppedStale: number;
  rejected: IngestResult["rejected"];
}

export function loadJobs(input: unknown, { replace = false, maxAgeDays }: LoadOptions = {}): LoadSummary {
  const { jobs: incoming, rejected } = normalizeJobs(input);
  const existing = replace || !existsSync(JOBS_FILE) ? [] : readJson<RawJob[]>(JOBS_FILE);
  const byId = new Map(existing.map((j) => [j.id, j]));
  let added = 0;
  let updated = 0;
  for (const job of incoming) {
    if (byId.has(job.id)) updated++;
    else added++;
    byId.set(job.id, job);
  }
  const { kept, dropped } = maxAgeDays ? dropStale([...byId.values()], maxAgeDays) : { kept: [...byId.values()], dropped: [] };

  mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
  writeFileSync(JOBS_FILE, JSON.stringify(kept, null, 2));
  return { added, updated, total: kept.length, droppedStale: dropped.length, rejected };
}

/** Forget the harness's postings; the app goes back to the demo pool. */
export function clearJobs(): void {
  rmSync(JOBS_FILE, { force: true });
}
