// Server-only helpers: where jobs come from and which assessor judges them.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { rulesAssessor, type Assessor, type RawJob } from "@jevjob/core";
import { createJevAssessor, fileCache } from "@jevjob/jev";

/** `npm run web` runs from apps/web; the repo root is two levels up. */
export const ROOT = path.resolve(process.cwd(), "../..");
const fromRoot = (...parts: string[]) => path.join(ROOT, ...parts);
const readJson = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;

try {
  process.loadEnvFile(fromRoot(".env"));
} catch {
  // No .env: Jev stays unavailable and the UI offers rules only.
}

export type JobSource = "harness" | "demo";

/**
 * A harness (Claude, Codex, oh-my-pi…) writes fresh postings to .jevjob/jobs.json.
 * Without one, the app uses the fictional postings from the eval set, so the demo works offline.
 */
export function loadJobs(): { source: JobSource; jobs: RawJob[] } {
  const harnessFile = fromRoot(".jevjob", "jobs.json");
  if (existsSync(harnessFile)) return { source: "harness", jobs: readJson<RawJob[]>(harnessFile) };
  const files = ["fixtures/jobs.json", "packages/eval/dataset/jobs.json", "packages/eval/dataset/heldout/jobs.json"];
  return { source: "demo", jobs: files.flatMap((f) => readJson<RawJob[]>(fromRoot(f))) };
}

export const jevAvailable = () => Boolean(process.env.TYPESAFE_API_KEY);
export const jevModel = () => process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest";

export type AssessorName = "rules" | "jev";

export function getAssessor(name: AssessorName): Assessor {
  if (name === "jev" && jevAvailable()) {
    return createJevAssessor({ cache: fileCache(pathToFileURL(fromRoot(".jevjob", "cache", "jev") + path.sep)) });
  }
  return rulesAssessor;
}

export interface Sample {
  key: string;
  name: string;
  headline: string;
  text: string;
}

/** The fictional candidates from the eval set, offered as one-click demo resumes. */
export function loadSamples(): Sample[] {
  const files: Array<[string, string, string]> = [
    ["jordan", "fixtures/resume.jordan-rivera.md", "New grad, CS"],
    ["priya", "packages/eval/dataset/resumes/priya-shah.md", "Bootcamp → frontend"],
    ["marcus", "packages/eval/dataset/resumes/marcus-bell.md", "Backend, 5 yrs"],
    ["elena", "packages/eval/dataset/resumes/elena-novak.md", "Data scientist, M.S."],
    ["sam", "packages/eval/dataset/heldout/resumes/sam-okafor.md", "IT support, 4 yrs"],
    ["grace", "packages/eval/dataset/heldout/resumes/grace-liu.md", "New grad, NLP"],
    ["devon", "packages/eval/dataset/heldout/resumes/devon-park.md", "Senior data eng"],
  ];
  return files.map(([key, file, headline]) => {
    const text = readFileSync(fromRoot(file), "utf8");
    const name = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? key;
    return { key, name, headline, text };
  });
}
