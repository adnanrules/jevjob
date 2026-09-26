// Turns Jev's typed answers into Assessments. Pure, so it's unit-tested with canned answers.
// Design rule: anything missing, malformed, or low-confidence falls back safely instead of guessing.
import { z } from "zod";
import {
  BORDERLINE_YEARS, SILENCE_MEANS_NO, yearsOf, type AssessedJob, type Assessment, type Resume, type Verdict,
} from "@jevjob/core";
import type { JevVerdict, Plan } from "./questions";

/** Tunable on the eval's dev split. Starting values follow the docs' advice: conservative first. */
export const JEV_POLICY = {
  /** Choice answers less confident than this become "unclear" (the docs' confidence-routing pattern). */
  minConfidence: 0.3, // v2: swept on dev (0.2-0.6); clearer questions made 0.5 too cautious
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

export function interpret(base: AssessedJob, plan: Plan, rawAnswers: unknown, resume: Resume): AssessedJob {
  const answers = Answers.parse(rawAnswers);
  const choiceAt = (key: string | undefined) => (key ? ChoiceAnswer.safeParse(answers[key]).data : undefined);
  const noulAt = (key: string | undefined) => (key ? NoulAnswer.safeParse(answers[key]).data?.noul : undefined);

  const assessments = base.assessments.map((rule): Assessment => {
    const req = base.requirements.find((r) => r.id === rule.requirementId)!;

    const requires = noulAt(plan.lineRequires.get(req.text));
    if (requires !== undefined && requires < JEV_POLICY.notARequirementBelow) {
      return { ...rule, verdict: "meets", evidence: "The posting says this isn't required", source: "jev", confidence: noulCertainty(requires) };
    }

    const roleKeys = plan.experienceRoles.get(req.id);
    if (req.kind === "experience" && roleKeys?.length) {
      const roleAnswers = roleKeys.map((key) => noulAt(key));
      if (roleAnswers.every((p) => p !== undefined)) {
        // Jev said which roles are the right kind; code does the arithmetic.
        const yes = resume.roles.filter((_, k) => roleAnswers[k]! >= JEV_POLICY.noulYes);
        const yesOrMaybe = resume.roles.filter((_, k) => roleAnswers[k]! > JEV_POLICY.noulNo);
        const sure = yearsOf(yes);
        const possible = yearsOf(yesOrMaybe);
        const verdict: Verdict =
          sure >= req.minYears ? "meets"
          : possible >= req.minYears || req.minYears - sure <= BORDERLINE_YEARS ? "unclear"
          : "does_not_meet";
        const evidence = yes.length ? `${sure} years of matching work: ${yes.map((r) => r.title).join(", ")}` : "No matching roles";
        const confidence = roleAnswers.reduce((s, p) => s + noulCertainty(p!), 0) / roleAnswers.length;
        return { ...rule, verdict, evidence, source: "jev", confidence };
      }
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
