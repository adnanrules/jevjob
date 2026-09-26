// Pure metric math: CaseResult[] → Metrics. No I/O, so it's unit-tested on tiny hand-made inputs.
import { TIER_ORDER, type Tier, type Verdict } from "@jevjob/core";

export interface CaseResult {
  id: string;
  split: "dev" | "test";
  expected: { tier: Tier; blockers: string[] };
  predicted: { tier: Tier; blockers: string[] };
  /** `predicted: null` means no extracted requirement matched the line at all. */
  checks: Array<{ requirement: string; expected: Verdict; predicted: Verdict | null }>;
  latencyMs: number;
  /** External API calls made for this case (0 for rules). */
  calls: number;
  inputTokens: number;
  /** Answered from the local cache: counts toward calls and tokens, but not latency. */
  cached: boolean;
}

/** A count, never a bare percentage: "3 of 12" tells you how much to trust it; "25%" hides that. */
export interface Rate {
  hits: number;
  of: number;
}

export interface Metrics {
  cases: number;
  tierAccuracy: Rate;
  withinOneTier: Rate;
  /** Of the jobs you should go for (apply/maybe), how many did we tell you to skip (big_stretch/no)? */
  falseSkip: Rate;
  /** Of the jobs that are a stretch or worse, how many did we tell you to just apply to? */
  falseApply: Rate;
  blockerRecall: Rate;
  blockerPrecision: Rate;
  requirementChecks: Rate;
  /** Checks where extraction produced no requirement for that line at all. */
  notExtracted: number;
  /** Over cases that weren't cached; null when every case came from the cache. */
  meanLatencyMs: number | null;
  callsPerJob: number;
  inputTokensPerJob: number;
  /** confusion[expected][predicted] = count. */
  confusion: Record<Tier, Record<Tier, number>>;
}

const WORTH_APPLYING = new Set<Tier>(["apply", "maybe"]);
const SKIPPED = new Set<Tier>(["big_stretch", "no"]);

export function computeMetrics(results: CaseResult[]): Metrics {
  const rate = (hit: (r: CaseResult) => boolean, among: (r: CaseResult) => boolean = () => true): Rate => {
    const pool = results.filter(among);
    return { hits: pool.filter(hit).length, of: pool.length };
  };
  const tierDistance = (r: CaseResult) =>
    Math.abs(TIER_ORDER.indexOf(r.expected.tier) - TIER_ORDER.indexOf(r.predicted.tier));

  let blockerHits = 0;
  let expectedBlockers = 0;
  let predictedBlockers = 0;
  for (const r of results) {
    const expected = new Set(r.expected.blockers);
    const predicted = new Set(r.predicted.blockers);
    expectedBlockers += expected.size;
    predictedBlockers += predicted.size;
    blockerHits += [...predicted].filter((b) => expected.has(b)).length;
  }

  const checks = results.flatMap((r) => r.checks);
  const confusion = Object.fromEntries(
    TIER_ORDER.map((e) => [e, Object.fromEntries(TIER_ORDER.map((p) => [p, 0]))]),
  ) as Record<Tier, Record<Tier, number>>;
  for (const r of results) confusion[r.expected.tier][r.predicted.tier]++;

  const n = results.length;
  const timed = results.filter((r) => !r.cached);
  return {
    cases: n,
    tierAccuracy: rate((r) => tierDistance(r) === 0),
    withinOneTier: rate((r) => tierDistance(r) <= 1),
    falseSkip: rate((r) => SKIPPED.has(r.predicted.tier), (r) => WORTH_APPLYING.has(r.expected.tier)),
    falseApply: rate((r) => r.predicted.tier === "apply", (r) => !WORTH_APPLYING.has(r.expected.tier)),
    blockerRecall: { hits: blockerHits, of: expectedBlockers },
    blockerPrecision: { hits: blockerHits, of: predictedBlockers },
    requirementChecks: { hits: checks.filter((c) => c.predicted === c.expected).length, of: checks.length },
    notExtracted: checks.filter((c) => c.predicted === null).length,
    meanLatencyMs: timed.length ? timed.reduce((s, r) => s + r.latencyMs, 0) / timed.length : null,
    callsPerJob: n ? results.reduce((s, r) => s + r.calls, 0) / n : 0,
    inputTokensPerJob: n ? results.reduce((s, r) => s + r.inputTokens, 0) / n : 0,
    confusion,
  };
}

export const formatRate = ({ hits, of }: Rate) => (of === 0 ? "n/a" : `${hits}/${of} (${Math.round((100 * hits) / of)}%)`);
