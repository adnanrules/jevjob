// Loads the labeled eval set. Paths inside cases.json are relative to the repo root.
import { readFileSync } from "node:fs";
import type { RawJob, Tier, Verdict } from "@jevjob/core";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

export interface Check {
  /** Case-insensitive substring of the posting line this check is about. */
  requirement: string;
  verdict: Verdict;
}

export interface EvalCase {
  id: string;
  resume: string;
  job: string;
  split: "dev" | "test";
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
  cases: Array<Omit<EvalCase, "id">>;
}

export function loadDataset(): Dataset {
  const file = JSON.parse(read("packages/eval/dataset/cases.json")) as CasesFile;
  const jobs = new Map(
    file.jobFiles.flatMap((path) => (JSON.parse(read(path)) as RawJob[]).map((job) => [job.id, job] as const)),
  );
  const resumes = new Map(Object.entries(file.resumes).map(([key, path]) => [key, read(path)]));
  const cases = file.cases.map((c) => ({ ...c, id: `${c.resume}/${c.job}` }));
  return { asOf: new Date(file.asOf), resumes, jobs, cases };
}
