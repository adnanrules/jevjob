// Turns Jev's typed answers into Assessments. Pure, so it's unit-tested with canned answers.
// Design rule: anything missing, malformed, or low-confidence falls back safely instead of guessing.
import { z } from "zod";
import { SILENCE_MEANS_NO, worstVerdict, type AssessedJob, type Assessment, type Verdict } from "@jevjob/core";
import type { JevVerdict, Plan } from "./questions";

/** Tunable on the eval's dev split. Starting values follow the docs' advice: conservative first. */
export const JEV_POLICY = {
  /** Choice answers less confident than this become "unclear" (the docs' confidence-routing pattern). */
  minConfidence: 0.5,
  /** Noul above this counts as yes, below `noulNo` as no, in between as unclear. */
  noulYes: 0.7,
  noulNo: 0.3,
  /** A required line whose "does this require anything?" Noul is below this is treated as no requirement. */
  notARequirementBelow: 0.2,
} as const;

// Validate at the boundary: the SDK is typed, but a server change should fail loudly here, not deep in the UI.
const ChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()),
});
const NoulAnswer = z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) });
const Answers = z.record(z.string(), z.unknown());

const TO_VERDICT: Record<JevVerdict, Verdict> = {
  meets: "meets",
  partial: "unclear",
  not_stated: "unclear",
  does_not_meet: "does_not_meet",
};

/** Noul has no separate confidence; distance from 0.5 is how sure it is (0 = coin flip, 1 = certain). */
const noulCertainty = (p: number) => Math.abs(p - 0.5) * 2;

export function interpret(base: AssessedJob, plan: Plan, rawAnswers: unknown): AssessedJob {
  const answers = Answers.parse(rawAnswers);
  const choiceAt = (key: string | undefined) => (key ? ChoiceAnswer.safeParse(answers[key]).data : undefined);
  const noulAt = (key: string | undefined) => (key ? NoulAnswer.safeParse(answers[key]).data?.noul : undefined);

  const assessments = base.assessments.map((rule): Assessment => {
    const req = base.requirements.find((r) => r.id === rule.requirementId)!;

    const requires = noulAt(plan.lineRequires.get(req.text));
    if (requires !== undefined && requires < JEV_POLICY.notARequirementBelow) {
      return { ...rule, verdict: "meets", evidence: "The posting says this isn't required", source: "jev", confidence: noulCertainty(requires) };
    }

    const kind = noulAt(plan.experienceKind.get(req.id));
    if (kind !== undefined) {
      const kindVerdict: Verdict = kind >= JEV_POLICY.noulYes ? "meets" : kind <= JEV_POLICY.noulNo ? "does_not_meet" : "unclear";
      // Code judged the years, Jev judged the kind. Both have to hold.
      return { ...rule, verdict: worstVerdict([rule.verdict, kindVerdict]), source: "jev", confidence: noulCertainty(kind) };
    }

    const answer = choiceAt(plan.verdict.get(req.id));
    if (!answer || !(answer.choice in TO_VERDICT)) return rule; // No usable answer: keep the rules baseline.

    const label = answer.choice as JevVerdict;
    let verdict = answer.confidence < JEV_POLICY.minConfidence ? "unclear" : TO_VERDICT[label];
    if (label === "not_stated" && req.kind === "eligibility" && SILENCE_MEANS_NO.has(req.eligibility)) verdict = "does_not_meet";
    // Jev doesn't write text, so evidence is the rules' matching resume line when they agree it's met.
    const evidence = verdict === rule.verdict ? rule.evidence : null;
    return { ...rule, verdict, evidence, source: "jev", confidence: answer.confidence };
  });

  return { ...base, assessments };
}
