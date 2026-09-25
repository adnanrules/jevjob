// JevJob domain model. Types only: no logic, no I/O, no imports from other layers.
// Every other module (extraction, assessors, policy, UI, MCP) speaks in these types.

// ── Inputs ──────────────────────────────────────────────────────────────────

/** A posting exactly as a provider hands it over. Nothing inferred yet. */
export interface RawJob {
  /** `company:source:externalId`, the same shape Joboid uses. */
  id: string;
  company: string;
  title: string;
  location: string;
  /** The employer's own careers page whenever possible, not an aggregator. */
  applyUrl: string;
  /** ISO date (YYYY-MM-DD). */
  postedAt?: string;
  /** Plain-text description. Requirement extraction reads this. */
  description: string;
}

/** Ordered lowest → highest, so "does X meet Y?" is an index comparison. */
export const DEGREE_LEVELS = ["none", "associate", "bachelor", "master", "phd"] as const;
export type DegreeLevel = (typeof DEGREE_LEVELS)[number];

/** Hard legal/administrative gates. Usually not on a resume at all. */
export type EligibilityKind =
  | "us_citizenship"
  | "security_clearance"
  | "work_authorization"
  | "professional_license";

export interface Resume {
  rawText: string;
  /** Canonical lowercase names ("postgresql", not "Postgres"). */
  skills: string[];
  /** Highest degree completed or expected. */
  degree: DegreeLevel;
  /** Professional experience in years; a 3-month internship is 0.25. */
  yearsExperience: number;
  /** A missing key means UNKNOWN, never false. Resume silence ≠ "doesn't have it". */
  eligibility: Partial<Record<EligibilityKind, boolean>>;
}

// ── Requirements: what a posting asks for ───────────────────────────────────

export type Importance = "required" | "preferred";

interface RequirementBase {
  /** Unique within a job, e.g. `${jobId}#r3`. Assessments point at this. */
  id: string;
  /** The original line from the posting. The UI shows this, colored by verdict. */
  text: string;
  importance: Importance;
}

/**
 * A discriminated union: `kind` says which extra fields exist.
 * Code does `switch (req.kind)` and TypeScript knows the exact shape in each branch.
 */
export type Requirement =
  /** Satisfied by ANY one of these skills: "Java or Python" → ["java", "python"]. */
  | (RequirementBase & { kind: "skill"; anyOf: string[] })
  | (RequirementBase & { kind: "education"; minDegree: DegreeLevel; orEquivalentExperience: boolean })
  /** "0-2 years" → minYears 0. */
  | (RequirementBase & { kind: "experience"; minYears: number })
  | (RequirementBase & { kind: "eligibility"; eligibility: EligibilityKind })
  /** Anything we can't structure yet ("strong communication skills"). */
  | (RequirementBase & { kind: "other" });

export type RequirementKind = Requirement["kind"];

// ── Facts: does the resume meet each requirement? (rules today, Jev later) ─

/** Maps 1:1 to the UI colors: green / yellow / red. */
export type Verdict = "meets" | "unclear" | "does_not_meet";

export type AssessmentSource = "rules" | "jev";

export interface Assessment {
  requirementId: string;
  verdict: Verdict;
  /** The resume text that justifies the verdict, if there is any. */
  evidence: string | null;
  source: AssessmentSource;
  /** 0–1 classifier confidence. null for rules: we don't invent a number we didn't measure. */
  confidence: number | null;
}

/** The expensive, cacheable part. It only changes when the resume or the posting changes. */
export interface AssessedJob {
  job: RawJob;
  requirements: Requirement[];
  assessments: Assessment[];
}

// ── Policy: facts → tier (pure, instant, re-runs on every slider move) ─────

export type Tier = "apply" | "maybe" | "stretch" | "big_stretch" | "no";

/** 0 = conservative … 1 = apply anyway. Only the policy reads this. */
export type Aggressiveness = number;

export type BlockerKind = EligibilityKind | "experience_years";

/** A required item that's unmet in a way no amount of "apply anyway" fixes. */
export interface Blocker {
  kind: BlockerKind;
  requirementId: string;
}

/** Counts, not percentages: the UI divides. `unclear` is kept apart from `met` on purpose. */
export interface Coverage {
  met: number;
  unclear: number;
  total: number;
}

export interface RankedJob extends AssessedJob {
  blockers: Blocker[];
  coverage: { required: Coverage; preferred: Coverage };
  tier: Tier;
  /** 1 = best fit in the current pool. */
  rank: number;
  /** Short human-readable lines built from the facts, e.g. "Missing: AWS (preferred)". */
  reasons: string[];
}
