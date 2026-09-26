// Builds ONE Jev request per job: state = the resume, one small typed question per requirement.
// Pure (no network), so it's unit-tested directly.
import { choice, noul, type Questions } from "@typesafe-ai/sdk";
import type { RawJob, Requirement, Resume } from "@jevjob/core";

/**
 * Four labels, not three: "not_stated" separates "the resume doesn't say" (citizenship, usually)
 * from "the resume would say if it were true, and doesn't" (a Kubernetes skill).
 */
export const VERDICT_CRITERIA = {
  meets: "The resume clearly shows the candidate satisfies this requirement.",
  partial:
    "The resume shows related or partial evidence but not a clear match: a similar skill, less depth, or an adjacent field.",
  not_stated: "The resume doesn't say either way, and this is something resumes commonly leave out.",
  does_not_meet: "The resume shows the candidate lacks this, or it's something a resume would list and this one doesn't.",
} as const;
export type JevVerdict = keyof typeof VERDICT_CRITERIA;

/** Which question answers what. The interpreter needs this to map answers back to requirements. */
export interface Plan {
  /** requirementId → key of its Choice verdict question (skill, education, eligibility, other). */
  verdict: Map<string, string>;
  /** requirementId → key of the Noul asking whether the candidate's experience is the right KIND. */
  experienceKind: Map<string, string>;
  /** Posting line text → key of the Noul asking whether that line requires anything at all. */
  lineRequires: Map<string, string>;
}

export interface JevRequest {
  state: { resume: string };
  questions: Questions;
  plan: Plan;
}

export function buildRequest(resume: Resume, job: RawJob, requirements: Requirement[]): JevRequest {
  const questions: Questions = {};
  const plan: Plan = { verdict: new Map(), experienceKind: new Map(), lineRequires: new Map() };
  const jobName = `${job.title} at ${job.company}`;

  requirements.forEach((req, i) => {
    if (req.kind === "experience") {
      // Jev is "not a calculator": code compares the years; Jev only judges the kind of work.
      const key = `kind_${i}`;
      // No job title here: in v1 it pulled "is this the kind of work" toward "is this the job's field".
      // The explicit "names no kind → yes" rule is there because Jev answers literally (docs: model jaggedness).
      questions[key] = noul(
        {
          task: "Does the resume show professional work of the kind this line names? Ignore how many years.",
          line: req.text,
        },
        {
          true: "The resume shows professional work of the kind the line names (field, role type, or technology), or the line names no specific kind of work at all (for example just '0-2 years of experience').",
          false: "The line names a specific kind of work and the resume's professional work is a different kind.",
        },
      );
      plan.experienceKind.set(req.id, key);
    } else {
      const key = `req_${i}`;
      questions[key] = choice(
        {
          task: "Does the candidate's resume meet this requirement from the job posting?",
          job: jobName,
          requirement: req.text,
          // A line like "TypeScript and React" becomes two requirements; each question judges only its own part.
          ...(req.kind === "skill" && { judge_only: req.anyOf.length > 1 ? `any one of: ${req.anyOf.join(", ")}` : req.anyOf[0] }),
        },
        VERDICT_CRITERIA,
      );
      plan.verdict.set(req.id, key);
    }

    // Negations like "A degree is not required" are a known weak spot, so they get their own simple,
    // affirmatively phrased question. Only for required lines: a bare "AWS" under "Nice to have" isn't a trap.
    if (req.importance === "required" && !plan.lineRequires.has(req.text)) {
      const key = `line_${plan.lineRequires.size}`;
      questions[key] = noul(
        { task: "Does this job posting line require something from the candidate?", line: req.text },
        {
          true: "It asks the candidate to have a skill, credential, amount of experience, or eligibility.",
          false: "It says something is not required or optional, or it doesn't ask anything of the candidate.",
        },
      );
      plan.lineRequires.set(req.text, key);
    }
  });

  return { state: { resume: resume.rawText }, questions, plan };
}
