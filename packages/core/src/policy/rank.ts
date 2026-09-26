// Policy: facts (AssessedJob) + aggressiveness → tier, blockers, reasons, rank.
// Pure and instant: no I/O, no API calls. The slider re-runs only this file.
import type {
  AssessedJob, Aggressiveness, Assessment, Blocker, Coverage, Importance, RankedJob, Requirement, Tier, Verdict,
} from "../domain";

export interface Policy {
  blockerYears: number;
  hardGapPenalty: number;
  preferredWeight: number;
  thresholds: { apply: number; maybe: number; stretch: number };
  thresholdSwing: number;
}

/**
 * Every tunable number in one place. `npm run sweep` searches these on the dev set only.
 * v1 was hand-tuned on the 5 fixtures. v2 (from the sweep) changed just two values: stretch 0 → 0.5 and
 * hardGapPenalty 0.15 → 0. The top sweep result changed four values for one more correct dev case,
 * which is the kind of gain that doesn't survive new data.
 */
export const POLICY: Policy = {
  /** An unmet years bar at or above this is a blocker, not a gap ("7+ years" for a new grad). */
  blockerYears: 5,
  /** Extra cost per unmet required degree/years bar. The v2 sweep found it didn't help (0), but kept for experiments. */
  hardGapPenalty: 0,
  /** Preferred items nudge ranking; they should never decide a tier on their own. */
  preferredWeight: 0.1,
  /** Minimum fit for each tier at aggressiveness 0.5. Stretch = meets about half the required items. */
  thresholds: { apply: 0.9, maybe: 0.65, stretch: 0.5 },
  /** Aggressiveness 0 raises every threshold by this much; 1 lowers them by the same. */
  thresholdSwing: 0.1,
};

export const TIER_ORDER: readonly Tier[] = ["apply", "maybe", "stretch", "big_stretch", "no"];

interface Row {
  req: Requirement;
  verdict: Verdict;
}

/** Rank a pool of assessed jobs. Best first; `rank` is 1-based. */
export function rankJobs(pool: AssessedJob[], aggressiveness: Aggressiveness = 0.5, policy: Policy = POLICY): RankedJob[] {
  return pool
    .map((job) => classify(job, aggressiveness, policy))
    .sort((a, b) => TIER_ORDER.indexOf(a.ranked.tier) - TIER_ORDER.indexOf(b.ranked.tier) || b.fit - a.fit)
    .map(({ ranked }, i) => ({ ...ranked, rank: i + 1 }));
}

/** One job's tier plus its internal `fit`, which is used only for sorting and never shown as a percentage. */
export function classify(
  job: AssessedJob,
  aggressiveness: Aggressiveness,
  policy: Policy = POLICY,
): { ranked: RankedJob; fit: number } {
  const a = Math.min(1, Math.max(0, aggressiveness));
  const rows = joinAssessments(job);
  const required = rows.filter((r) => r.req.importance === "required");
  const preferred = rows.filter((r) => r.req.importance === "preferred");

  const blockers = findBlockers(required, policy.blockerYears);
  const hardGaps = required.filter(
    (r) => r.verdict === "does_not_meet" && (r.req.kind === "education" || r.req.kind === "experience"),
  ).length;

  // Aggressiveness does two things: how much benefit of the doubt "unclear" gets, and how low the bars go.
  const unclearCredit = 0.25 + 0.5 * a;
  const fit =
    score(required, unclearCredit) + policy.preferredWeight * score(preferred, unclearCredit) - policy.hardGapPenalty * hardGaps;
  const shift = (0.5 - a) * 2 * policy.thresholdSwing;

  const tier: Tier =
    blockers.length > 0 ? "no" // "Apply anyway" can't give you a clearance.
    : fit >= policy.thresholds.apply + shift ? "apply"
    : fit >= policy.thresholds.maybe + shift ? "maybe"
    : fit >= policy.thresholds.stretch + shift ? "stretch"
    : "big_stretch";

  const ranked: RankedJob = {
    ...job,
    blockers,
    coverage: { required: coverage(required), preferred: coverage(preferred) },
    tier,
    rank: 0,
    reasons: reasons(required, preferred, blockers),
  };
  return { ranked, fit };
}

function joinAssessments({ requirements, assessments }: AssessedJob): Row[] {
  const byId = new Map<string, Assessment>(assessments.map((x) => [x.requirementId, x]));
  // A requirement with no assessment is treated as unclear rather than crashing or silently passing.
  return requirements.map((req) => ({ req, verdict: byId.get(req.id)?.verdict ?? "unclear" }));
}

function findBlockers(required: Row[], blockerYears: number): Blocker[] {
  const blockers: Blocker[] = [];
  for (const { req, verdict } of required) {
    if (verdict !== "does_not_meet") continue; // Unclear is never a blocker: we don't reject on missing info.
    if (req.kind === "eligibility") blockers.push({ kind: req.eligibility, requirementId: req.id });
    if (req.kind === "experience" && req.minYears >= blockerYears) {
      blockers.push({ kind: "experience_years", requirementId: req.id });
    }
  }
  return blockers;
}

/** Share of items met, with unclear items counted as partly met. No items means nothing to fail: 1. */
function score(rows: Row[], unclearCredit: number): number {
  if (rows.length === 0) return 1;
  const points = rows.reduce((sum, r) => sum + (r.verdict === "meets" ? 1 : r.verdict === "unclear" ? unclearCredit : 0), 0);
  return points / rows.length;
}

function coverage(rows: Row[]): Coverage {
  return {
    met: rows.filter((r) => r.verdict === "meets").length,
    unclear: rows.filter((r) => r.verdict === "unclear").length,
    total: rows.length,
  };
}

/** Short lines for the UI, most important first. One line per posting bullet, even if it produced several requirements. */
function reasons(required: Row[], preferred: Row[], blockers: Blocker[]): string[] {
  const blockerIds = new Set(blockers.map((b) => b.requirementId));
  const req = coverage(required);
  const lines = [
    ...required.filter((r) => blockerIds.has(r.req.id)).map((r) => `Blocker: ${r.req.text}`),
    `Meets ${req.met} of ${req.total} required${req.unclear ? ` (${req.unclear} unclear)` : ""}`,
    ...required.filter((r) => r.verdict === "does_not_meet" && !blockerIds.has(r.req.id)).map((r) => `Missing: ${r.req.text}`),
    ...required.filter((r) => r.verdict === "unclear").map((r) => `Unclear: ${r.req.text}`),
    ...preferred.filter((r) => r.verdict === "does_not_meet").map((r) => `Nice-to-have missing: ${r.req.text}`),
  ];
  return [...new Set(lines)];
}
