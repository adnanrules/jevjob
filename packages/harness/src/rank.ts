// Headless ranking for harnesses: a compact, token-cheap summary instead of the full facts.
// This is the "don't burn your Claude/ChatGPT usage" path: the harness reads ~one line per job.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { parseResume, rankJobs, rulesAssessor, type Assessor, type AssessedJob, type Tier } from "@jevjob/core";
import { createJevAssessor, fileCache } from "@jevjob/jev";
import { currentJobs, type JobSource } from "./jobs";
import { JEV_CACHE_DIR, loadEnv } from "./paths";

export type Engine = "jev" | "rules";

export function jevAvailable(): boolean {
  loadEnv();
  return Boolean(process.env.TYPESAFE_API_KEY);
}

export function getAssessor(engine: Engine | "auto"): Assessor {
  if (engine !== "rules" && jevAvailable()) {
    return createJevAssessor({ cache: fileCache(pathToFileURL(JEV_CACHE_DIR + path.sep)) });
  }
  if (engine === "jev") throw new Error("Jev isn't configured: add TYPESAFE_API_KEY to JevJob's .env.");
  return rulesAssessor;
}

export interface RankSummary {
  engine: Engine;
  source: JobSource;
  jobs: number;
  jevCalls: number;
  inputTokens: number;
  tiers: Record<Tier, number>;
  top: Array<{
    rank: number;
    tier: Tier;
    title: string;
    company: string;
    location: string;
    apply: string;
    required: string;
    blockers: string[];
    gaps: string[];
  }>;
}

export async function rankResume(
  resumeText: string,
  { engine = "auto", top = 10, aggressiveness = 0.5 }: { engine?: Engine | "auto"; top?: number; aggressiveness?: number } = {},
): Promise<RankSummary> {
  const assessor = getAssessor(engine);
  const resume = parseResume(resumeText);
  const { source, jobs } = currentJobs();

  const assessed: AssessedJob[] = [];
  let calls = 0;
  let inputTokens = 0;
  for (let i = 0; i < jobs.length; i += 4) {
    const batch = await Promise.all(jobs.slice(i, i + 4).map((job) => assessor.assess(resume, job).catch(() => rulesAssessor.assess(resume, job))));
    for (const r of batch) {
      assessed.push(r.assessed);
      calls += r.calls;
      inputTokens += r.inputTokens;
    }
  }

  const ranked = rankJobs(assessed, aggressiveness);
  const tiers = { apply: 0, maybe: 0, stretch: 0, big_stretch: 0, no: 0 } as Record<Tier, number>;
  for (const r of ranked) tiers[r.tier]++;

  return {
    engine: assessor.name as Engine,
    source,
    jobs: ranked.length,
    jevCalls: calls,
    inputTokens,
    tiers,
    top: ranked.slice(0, top).map((r) => {
      const blockerIds = new Set(r.blockers.map((b) => b.requirementId));
      const verdict = new Map(r.assessments.map((a) => [a.requirementId, a.verdict]));
      return {
        rank: r.rank,
        tier: r.tier,
        title: r.job.title,
        company: r.job.company,
        location: r.job.location,
        apply: r.job.applyUrl,
        required: `${r.coverage.required.met}/${r.coverage.required.total}`,
        blockers: r.requirements.filter((q) => blockerIds.has(q.id)).map((q) => q.text),
        gaps: [...new Set(r.requirements.filter((q) => q.importance === "required" && verdict.get(q.id) === "does_not_meet" && !blockerIds.has(q.id)).map((q) => q.text))].slice(0, 3),
      };
    }),
  };
}
