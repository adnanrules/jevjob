// Builds ONE Jev request per job: state = the resume, one small typed question per requirement.
// Pure (no network), so it's unit-tested directly.
import { choice, noul, type Questions } from "@typesafe-ai/sdk";
import { yearsOf, type RawJob, type Requirement, type Resume } from "@jevjob/core";

/**
 * Four labels, not three: "not_stated" separates "the resume doesn't say" (citizenship, usually)
 * from "the resume would say if it were true, and doesn't" (a Kubernetes skill).
 * v2 wording (dev-set errors): v1 answered does_not_meet for JavaScript vs TypeScript, and unclear for a math degree vs
 * "CS or a related field". Alternatives a requirement allows now count as met; close relatives count as partial.
 */
export const VERDICT_CRITERIA = {
  meets:
    "The resume shows the candidate satisfies this requirement, including through an alternative the requirement itself allows ('or a related field', 'or equivalent experience'). Use `facts` for degrees and years.",
  partial:
    "Related evidence but not a full match: a closely related skill (JavaScript for a TypeScript requirement), coursework or personal projects where professional use is asked for, or less depth than asked.",
  not_stated:
    "The resume doesn't say either way, and it's something resumes usually leave out: citizenship, a driver's license, willingness to travel, soft skills.",
  does_not_meet:
    "The resume shows the candidate lacks this, or the requirement names a specific skill, tool or credential that a resume would list, and nothing related appears.",
} as const;
export type JevVerdict = keyof typeof VERDICT_CRITERIA;

/**
 * What code already knows about the resume, stated plainly so Jev doesn't have to compute it
 * (the docs: "Jev is not a calculator"; it reads dates as text, not quantities).
 */
export function resumeFacts(resume: Resume) {
  const education = resume.rawText
    .split("\n")
    .map((l) => l.replace(/\*\*/g, "").replace(/^[-*•]\s*/, "").trim())
    .filter((l) => l.length < 160 && /\b(B\.?S\.?|B\.?A\.?|M\.?S\.?|Ph\.?\s?D|bachelor|master|associate of|doctorate|degree|diploma|certificate|bootcamp)\b/i.test(l))
    .slice(0, 4);
  return {
    highest_degree: resume.degree,
    education,
    jobs: resume.roles.map((r) => `${r.title}: ${r.endMonth - r.startMonth + 1} months`),
    years_across_all_jobs: yearsOf(resume.roles),
    skills_named: resume.skills,
  };
}

/** Which question answers what. The interpreter needs this to map answers back to requirements. */
export interface Plan {
  /** requirementId → key of its Choice verdict question (skill, education, eligibility, other). */
  verdict: Map<string, string>;
  /** requirementId → one Noul key per resume role ("is this role the kind of work the line asks for?"). */
  experienceRoles: Map<string, string[]>;
  /** Posting line text → key of the Noul asking whether that line requires anything at all. */
  lineRequires: Map<string, string>;
}

export interface JevRequest {
  state: { resume: string; facts: ReturnType<typeof resumeFacts> };
  questions: Questions;
  plan: Plan;
}

export function buildRequest(resume: Resume, job: RawJob, requirements: Requirement[]): JevRequest {
  const questions: Questions = {};
  const plan: Plan = { verdict: new Map(), experienceRoles: new Map(), lineRequires: new Map() };
  const jobName = `${job.title} at ${job.company}`;

  requirements.forEach((req, i) => {
    if (req.kind === "experience") {
      // "Atomic questions, composed in code": Jev judges each role's KIND of work; code adds up the months
      // of the roles that qualify (Jev is "not a calculator"). No job title in the question: in v1 it pulled
      // "is this the kind of work" toward "is this the job's field". "Names no kind → yes" is spelled out
      // because Jev answers literally.
      const keys = resume.roles.map((role, k) => {
        const key = `role_${i}_${k}`;
        questions[key] = noul(
          { task: "Is this job from the candidate's resume the kind of work this posting line asks for? Ignore how long it lasted.", line: req.text, role: role.text },
          {
            true: "The role is the kind of work the line names (field, role type, or technology), or the line names no specific kind of work at all (for example just '0-2 years of experience').",
            false: "The line names a specific kind of work and this role is a different kind.",
          },
        );
        return key;
      });
      plan.experienceRoles.set(req.id, keys);
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

  return { state: { resume: resume.rawText, facts: resumeFacts(resume) }, questions, plan };
}
