// The NDJSON event stream between /api/rank and the browser. Shared by both sides.
import type { AssessedJob } from "@jevjob/core";

export interface JobCard {
  id: string;
  company: string;
  title: string;
  location: string;
  applyUrl: string;
}

export type RankEvent =
  | { type: "start"; assessor: "rules" | "jev"; model: string | null; source: "harness" | "demo"; jobs: JobCard[] }
  /** Requirements were extracted from the posting. */
  | { type: "parsed"; id: string; requirements: number }
  /** Facts are in. `fallback` means Jev failed for this job and the rules answered instead. */
  | { type: "assessed"; id: string; assessed: AssessedJob; ms: number; cached: boolean; fallback: boolean }
  | { type: "done"; resume: { degree: string; skills: string[]; roles: number } }
  | { type: "error"; message: string };
