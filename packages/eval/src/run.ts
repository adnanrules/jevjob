// Runs every labeled case through a system and writes packages/eval/results/<system>.{json,md}.
// Run: npm run eval
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  assessJob, classify, parseResume, type AssessedJob, type RawJob, type Resume, type Verdict,
} from "@jevjob/core";
import { loadDataset, type EvalCase } from "./dataset";
import { computeMetrics, formatRate, type CaseResult } from "./metrics";
import { renderMarkdown, type RunInfo } from "./report";

/** Anything that turns (resume, job) into facts. Rules today; Jev plugs in here with no other changes. */
export interface System {
  name: string;
  assess(resume: Resume, job: RawJob): Promise<{ assessed: AssessedJob; calls: number }>;
}

const rules: System = {
  name: "rules",
  assess: async (resume, job) => ({ assessed: assessJob(resume, job), calls: 0 }),
};

/** All eval runs use the default slider position so systems are compared on the same policy. */
const AGGRESSIVENESS = 0.5;

async function runCase(system: System, resume: Resume, job: RawJob, c: EvalCase): Promise<CaseResult> {
  const start = performance.now();
  const { assessed, calls } = await system.assess(resume, job);
  const { ranked } = classify(assessed, AGGRESSIVENESS);
  const latencyMs = performance.now() - start;

  const verdictOf = new Map(assessed.assessments.map((a) => [a.requirementId, a.verdict]));
  const checks = c.checks.map((check) => {
    // One posting line can hold several requirements; the line's verdict is the worst of them.
    const verdicts = assessed.requirements
      .filter((r) => r.text.toLowerCase().includes(check.requirement.toLowerCase()))
      .map((r) => verdictOf.get(r.id) ?? "unclear");
    const predicted: Verdict | null =
      verdicts.length === 0 ? null
      : verdicts.includes("does_not_meet") ? "does_not_meet"
      : verdicts.includes("unclear") ? "unclear"
      : "meets";
    return { requirement: check.requirement, expected: check.verdict, predicted };
  });

  return {
    id: c.id,
    split: c.split,
    expected: { tier: c.tier, blockers: c.blockers },
    predicted: { tier: ranked.tier, blockers: ranked.blockers.map((b) => b.kind) },
    checks,
    latencyMs,
    calls,
  };
}

function gitInfo(): Pick<RunInfo, "commit" | "dirty"> {
  try {
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: "unknown", dirty: true };
  }
}

async function main() {
  const system = rules;
  const data = loadDataset();
  const resumes = new Map([...data.resumes].map(([key, text]) => [key, parseResume(text, { asOf: data.asOf })]));

  const results: CaseResult[] = [];
  for (const c of data.cases) {
    const resume = resumes.get(c.resume);
    const job = data.jobs.get(c.job);
    if (!resume || !job) throw new Error(`Case ${c.resume}/${c.job} points at a missing resume or job`);
    results.push(await runCase(system, resume, job, c));
  }

  const splits = {
    test: computeMetrics(results.filter((r) => r.split === "test")),
    dev: computeMetrics(results.filter((r) => r.split === "dev")),
    all: computeMetrics(results),
  };
  const info: RunInfo = { system: system.name, ...gitInfo() };

  const outDir = new URL("../results/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(new URL(`${system.name}.md`, outDir), renderMarkdown(info, splits, results));
  writeFileSync(new URL(`${system.name}.json`, outDir), JSON.stringify({ ...info, splits, results }, null, 2) + "\n");

  const t = splits.test;
  console.log(`${system.name} on ${t.cases} test cases`);
  console.log(`  tier accuracy      ${formatRate(t.tierAccuracy)}   within one tier ${formatRate(t.withinOneTier)}`);
  console.log(`  false-skip         ${formatRate(t.falseSkip)}   false-apply ${formatRate(t.falseApply)}`);
  console.log(`  blocker recall     ${formatRate(t.blockerRecall)}   precision ${formatRate(t.blockerPrecision)}`);
  console.log(`  requirement checks ${formatRate(t.requirementChecks)}   not extracted ${t.notExtracted}`);
  console.log(`  latency ${t.meanLatencyMs.toFixed(2)} ms/job, ${t.callsPerJob.toFixed(1)} external calls/job`);
  console.log(`Full report: packages/eval/results/${system.name}.md`);
}

await main();
