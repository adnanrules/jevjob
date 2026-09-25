// Policy: facts (AssessedJob) + aggressiveness → tier, blockers, reasons, rank.
// Pure and instant: no I/O, no API calls. The slider re-runs only this file.
import type {
  AssessedJob, Aggressiveness, Assessment, Blocker, Coverage, Importance, RankedJob, Requirement, Tier, Verdict,
} from "../domain";

/**
 * Every tunable number in one place, so the eval can sweep them later.
 * They were hand-tuned on the 5 fixtures, which is overfitting until the M2 eval set proves otherwise.
 */
export const POLICY = {
  /** An unmet years bar at or above this is a blocker, not a gap ("7+ years" for a new grad). */
  blockerYears: 5,
  /** Unmet required degree/years can't be learned in a weekend, so they cost extra. */
  hardGapPenalty: 0.15,
  /** Preferred items nudge ranking; they should never decide a tier on their own. */
  preferredWeight: 0.1,
  /** Minimum fit for each tier at aggressiveness 0.5. Anything lower is big_stretch. */
  thresholds: { apply: 0.9, maybe: 0.65, stretch: 0 },
  /** Aggressiveness 0 raises every threshold by this much; 1 lowers them by the same. */
  thresholdSwing: 0.1,
} as const;

export const TIER_ORDER: readonly Tier[] = ["apply", "maybe", "stretch", "big_stretch", "no"];

interface Row {
  req: Requirement;
  verdict: Verdict;
}

/** Rank a pool of assessed jobs. Best first; `rank` is 1-based. */
export function rankJobs(pool: AssessedJob[], aggressiveness: Aggressiveness = 0.5): RankedJob[] {
  return pool
    .map((job) => classify(job, aggressiveness))
    .sort((a, b) => TIER_ORDER.indexOf(a.ranked.tier) - TIER_ORDER.indexOf(b.ranked.tier) || b.fit - a.fit)
    .map(({ ranked }, i) => ({ ...ranked, rank: i + 1 }));
}

/** One job's tier plus its internal `fit`, which is used only for sorting and never shown as a percentage. */
export function classify(job: AssessedJob, aggressiveness: Aggressiveness): { ranked: RankedJob; fit: number } {
  const a = Math.min(1, Math.max(0, aggressiveness));
  const rows = joinAssessments(job);
  const required = rows.filter((r) => r.req.importance === "required");
  const preferred = rows.filter((r) => r.req.importance === "preferred");

  const blockers = findBlockers(required);
  const hardGaps = required.filter(
    (r) => r.verdict === "does_not_meet" && (r.req.kind === "education" || r.req.kind === "experience"),
  ).length;

  // Aggressiveness does two things: how much benefit of the doubt "unclear" gets, and how low the bars go.
  const unclearCredit = 0.25 + 0.5 * a;
  const fit =
    score(required, unclearCredit) + POLICY.preferredWeight * score(preferred, unclearCredit) - POLICY.hardGapPenalty * hardGaps;
  const shift = (0.5 - a) * 2 * POLICY.thresholdSwing;

  const tier: Tier =
    blockers.length > 0 ? "no" // "Apply anyway" can't give you a clearance.
    : fit >= POLICY.thresholds.apply + shift ? "apply"
    : fit >= POLICY.thresholds.maybe + shift ? "maybe"
    : fit >= POLICY.thresholds.stretch + shift ? "stretch"
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

function findBlockers(required: Row[]): Blocker[] {
  const blockers: Blocker[] = [];
  for (const { req, verdict } of required) {
    if (verdict !== "does_not_meet") continue; // Unclear is never a blocker: we don't reject on missing info.
    if (req.kind === "eligibility") blockers.push({ kind: req.eligibility, requirementId: req.id });
    if (req.kind === "experience" && req.minYears >= POLICY.blockerYears) {
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
