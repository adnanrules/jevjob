// Runs every labeled case through an assessor and writes packages/eval/results/<name>.{json,md}.
// Run: npm run eval            (rules)
//      npm run eval -- jev     (needs TYPESAFE_API_KEY in .env; answers are cached in .jevjob/cache)
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { classify, parseResume, rulesAssessor, worstVerdict, type Assessor, type RawJob, type Resume } from "@jevjob/core";
import { createJevAssessor, fileCache } from "@jevjob/jev";
import { loadDataset, type EvalCase } from "./dataset";
import { computeMetrics, formatRate, type CaseResult } from "./metrics";
import { renderMarkdown, type RunInfo } from "./report";

const ROOT = new URL("../../../", import.meta.url);

/** All eval runs use the default slider position so assessors are compared on the same policy. */
const AGGRESSIVENESS = 0.5;

function pickAssessor(name: string): Assessor {
  if (name === "rules") return rulesAssessor;
  if (name === "jev") {
    try {
      process.loadEnvFile(new URL(".env", ROOT));
    } catch {
      // No .env file: fall through and let the SDK read the real environment.
    }
    if (!process.env.TYPESAFE_API_KEY) {
      throw new Error("Set TYPESAFE_API_KEY in .env (copy .env.example). OpenRouter keys work too; see .env.example.");
    }
    return createJevAssessor({ cache: fileCache(new URL(".jevjob/cache/jev/", ROOT)) });
  }
  throw new Error(`Unknown assessor "${name}". Use "rules" or "jev".`);
}

async function runCase(assessor: Assessor, resume: Resume, job: RawJob, c: EvalCase): Promise<CaseResult> {
  const start = performance.now();
  const { assessed, calls, inputTokens, cached } = await assessor.assess(resume, job);
  const { ranked } = classify(assessed, AGGRESSIVENESS);
  const latencyMs = performance.now() - start;

  const verdictOf = new Map(assessed.assessments.map((a) => [a.requirementId, a.verdict]));
  const checks = c.checks.map((check) => {
    const verdicts = assessed.requirements
      .filter((r) => r.text.toLowerCase().includes(check.requirement.toLowerCase()))
      .map((r) => verdictOf.get(r.id) ?? "unclear");
    return { requirement: check.requirement, expected: check.verdict, predicted: verdicts.length ? worstVerdict(verdicts) : null };
  });

  return {
    id: c.id,
    split: c.split,
    expected: { tier: c.tier, blockers: c.blockers },
    predicted: { tier: ranked.tier, blockers: ranked.blockers.map((b) => b.kind) },
    checks,
    latencyMs,
    calls,
    inputTokens,
    cached,
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
  const args = process.argv.slice(2);
  // --dev: tune without ever seeing held-out results. Writes <name>.dev.md so the real report isn't overwritten.
  const devOnly = args.includes("--dev");
  const assessor = pickAssessor(args.find((a) => !a.startsWith("--")) ?? "rules");
  const data = loadDataset();
  const resumes = new Map([...data.resumes].map(([key, text]) => [key, parseResume(text, { asOf: data.asOf })]));

  const results: CaseResult[] = [];
  for (const c of data.cases.filter((c) => !devOnly || c.split === "dev")) {
    const resume = resumes.get(c.resume);
    const job = data.jobs.get(c.job);
    if (!resume || !job) throw new Error(`Case ${c.id} points at a missing resume or job`);
    results.push(await runCase(assessor, resume, job, c));
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  const splits = {
    test: computeMetrics(results.filter((r) => r.split === "test")),
    dev: computeMetrics(results.filter((r) => r.split === "dev")),
    all: computeMetrics(results),
  };
  const info: RunInfo = { system: assessor.name, ...gitInfo() };

  const outDir = new URL("../results/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const outName = devOnly ? `${assessor.name}.dev` : assessor.name;
  writeFileSync(new URL(`${outName}.md`, outDir), renderMarkdown(info, splits, results));
  writeFileSync(new URL(`${outName}.json`, outDir), JSON.stringify({ ...info, splits, results }, null, 2) + "\n");

  console.log(`${assessor.name}: ${results.length} cases, ${results.filter((r) => r.cached).length} answered from cache`);
  for (const split of ["test", "dev"] as const) {
    const t = splits[split];
    if (!t.cases) continue;
    const latency = t.meanLatencyMs === null ? "n/a (all cached)" : `${t.meanLatencyMs.toFixed(2)} ms/job`;
    console.log(`\n${split.toUpperCase()} (n=${t.cases})${split === "dev" ? "  tuned on, optimistic" : ""}`);
    console.log(`  tier accuracy      ${formatRate(t.tierAccuracy)}   within one tier ${formatRate(t.withinOneTier)}`);
    console.log(`  false-skip         ${formatRate(t.falseSkip)}   false-apply ${formatRate(t.falseApply)}`);
    console.log(`  blocker recall     ${formatRate(t.blockerRecall)}   precision ${formatRate(t.blockerPrecision)}`);
    console.log(`  requirement checks ${formatRate(t.requirementChecks)}   not extracted ${t.notExtracted}`);
    console.log(`  latency ${latency}, ${t.callsPerJob.toFixed(1)} calls/job, ${Math.round(t.inputTokensPerJob)} input tokens/job`);
  }
  console.log(`\nFull report: packages/eval/results/${outName}.md`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
