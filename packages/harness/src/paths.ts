import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isRepoRoot = (dir: string) => {
  try {
    return (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: string }).name === "jevjob";
  } catch {
    return false;
  }
};

/**
 * The JevJob repo root. Usually packages/harness/src → ../../.., but inside a bundler (Next.js) import.meta.url
 * can point at a build chunk, so check a few candidates and take the first that really is the repo.
 */
function findRoot(): string {
  const candidates = [process.env.JEVJOB_ROOT, path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")];
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    candidates.push(dir);
    if (path.dirname(dir) === dir) break;
  }
  const root = candidates.find((dir): dir is string => Boolean(dir) && isRepoRoot(dir!));
  if (!root) throw new Error("Can't find the JevJob folder. Set JEVJOB_ROOT.");
  return root;
}

export const ROOT = findRoot();
export const fromRoot = (...parts: string[]) => path.join(ROOT, ...parts);

/** Where a harness's postings live. Deleting it puts the app back on the fictional demo pool. */
export const JOBS_FILE = fromRoot(".jevjob", "jobs.json");
export const JEV_CACHE_DIR = fromRoot(".jevjob", "cache", "jev");

/** Joboid's folder: JOBOID_DIR, or the Joboid repo this project lives inside (projects/jevjob → ../..). */
export function joboidDir(): string | null {
  const candidate = process.env.JOBOID_DIR ?? path.resolve(ROOT, "../..");
  return existsSync(path.join(candidate, "pyproject.toml")) && existsSync(path.join(candidate, "joboid")) ? candidate : null;
}

/** Reads the repo's .env once, so every entry point (CLI, MCP, web) sees the same TYPESAFE_* settings. */
export function loadEnv(): void {
  try {
    process.loadEnvFile(fromRoot(".env"));
  } catch {
    // No .env: Jev stays unavailable and everything runs on rules.
  }
}
