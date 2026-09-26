// Loads the labeled eval sets. The split comes from the FILE, never from a field a case could get wrong:
//   cases.json   → "dev": used for tuning, so its scores are optimistic.
//   heldout.json → "test": labeled before any system ran on it, and never used for tuning.
// Paths inside the files are relative to the repo root.
import { existsSync, readFileSync } from "node:fs";
import type { RawJob, Tier, Verdict } from "@jevjob/core";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

export type Split = "dev" | "test";

export interface Check {
  /** Case-insensitive substring of the posting line this check is about. */
  requirement: string;
  verdict: Verdict;
}

export interface EvalCase {
  id: string;
  resume: string;
  job: string;
  split: Split;
  tier: Tier;
  blockers: string[];
  checks: Check[];
  note?: string;
}

export interface Dataset {
  /** The "today" the labels were written against; resumes with "Present" are measured to this date. */
  asOf: Date;
  resumes: Map<string, string>;
  jobs: Map<string, RawJob>;
  cases: EvalCase[];
}

interface CasesFile {
  asOf: string;
  resumes: Record<string, string>;
  jobFiles: string[];
  cases: Array<Omit<EvalCase, "id" | "split">>;
}

const FILES: Array<[string, Split]> = [
  ["packages/eval/dataset/cases.json", "dev"],
  ["packages/eval/dataset/heldout.json", "test"],
];

export function loadDataset(): Dataset {
  const resumes = new Map<string, string>();
  const jobs = new Map<string, RawJob>();
  const cases: EvalCase[] = [];
  let asOf: string | undefined;

  for (const [path, split] of FILES) {
    if (!existsSync(new URL(path, ROOT))) continue;
    const file = JSON.parse(read(path)) as CasesFile;
    if (asOf && file.asOf !== asOf) throw new Error(`${path} uses asOf ${file.asOf}, expected ${asOf}`);
    asOf = file.asOf;
    for (const [key, resumePath] of Object.entries(file.resumes)) resumes.set(key, read(resumePath));
    for (const jobPath of file.jobFiles) for (const job of JSON.parse(read(jobPath)) as RawJob[]) jobs.set(job.id, job);
    cases.push(...file.cases.map((c) => ({ ...c, split, id: `${c.resume}/${c.job}` })));
  }
  if (!asOf) throw new Error("No eval dataset files found");
  return { asOf: new Date(asOf), resumes, jobs, cases };
}
