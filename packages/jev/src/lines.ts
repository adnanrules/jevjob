// Stage 1 of the extraction cascade: when the rules can't find a requirements section, Jev sorts every
// candidate line of the posting into required / preferred / duty / other. ("Two-stage extraction cascade"
// in TypeSafe's cookbook: cheap path first, the model only where the cheap path fails.)
import { choice, type Questions } from "@typesafe-ai/sdk";
import { z } from "zod";
import type { Importance, RawJob } from "@jevjob/core";
import { JEV_POLICY } from "./interpret";

export const LINE_ROLES = {
  required: "A qualification the candidate must have: a skill, degree, years of experience, certification, or eligibility.",
  preferred: "A qualification that is nice to have, a bonus, a plus, or preferred.",
  duty: "Something the person will do in the job. A responsibility, not a qualification.",
  other: "About the company, team, benefits, pay, location, or hiring process.",
} as const;

/** Postings run long; the classifier only needs enough context to tell qualifications from duties. */
const MAX_POSTING_CHARS = 12_000;

export function buildLineRequest(job: RawJob, lines: string[]): { state: { posting: string }; questions: Questions } {
  const questions: Questions = {};
  lines.forEach((line, i) => {
    questions[`role_of_line_${i}`] = choice({ task: "In this job posting, what is this line?", line }, LINE_ROLES);
  });
  return { state: { posting: `${job.title} at ${job.company}\n\n${job.description.slice(0, MAX_POSTING_CHARS)}` }, questions };
}

const ChoiceAnswer = z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number() });

/** Lines Jev is confident are qualifications, in posting order. Anything unsure or malformed is left out. */
export function pickRequirementLines(lines: string[], answers: unknown): Array<{ text: string; importance: Importance }> {
  const record = z.record(z.string(), z.unknown()).safeParse(answers).data ?? {};
  return lines.flatMap((text, i) => {
    const a = ChoiceAnswer.safeParse(record[`role_of_line_${i}`]).data;
    if (!a || a.confidence < JEV_POLICY.minConfidence) return [];
    return a.choice === "required" || a.choice === "preferred" ? [{ text, importance: a.choice }] : [];
  });
}
