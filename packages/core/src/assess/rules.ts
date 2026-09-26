// Rule-based assessor: (Resume, Requirement) → Assessment.
// This is the baseline Jev has to beat. Same inputs and outputs as the future Jev assessor,
// so the pipeline and the eval can swap one for the other.
import type { AssessedJob, Assessment, Assessor, EligibilityKind, RawJob, Requirement, Resume, Verdict } from "../domain";
import { degreeRank } from "../extract/patterns";
import { extractRequirements } from "../extract/requirements";
import { findSkillLine, RELATED_SKILLS } from "../skills";

/** Things you'd always put on a resume if you had them, so their absence counts as "no". */
export const SILENCE_MEANS_NO: ReadonlySet<EligibilityKind> = new Set(["security_clearance", "professional_license"]);

/** When one posting line produced several requirements, the line shows its worst verdict. */
export function worstVerdict(verdicts: Verdict[]): Verdict {
  return verdicts.includes("does_not_meet") ? "does_not_meet" : verdicts.includes("unclear") ? "unclear" : "meets";
}

export const rulesAssessor: Assessor = {
  name: "rules",
  assess: async (resume, job) => ({ assessed: assessJob(resume, job), calls: 0, inputTokens: 0, cached: false }),
};

/** How many years short still reads as "borderline" (yellow) instead of "no" (red). */
export const BORDERLINE_YEARS = 1;

export function assessRequirement(resume: Resume, req: Requirement): Assessment {
  const [verdict, evidence] = judge(resume, req);
  return { requirementId: req.id, verdict, evidence, source: "rules", confidence: null };
}

export function assessJob(resume: Resume, job: RawJob): AssessedJob {
  const requirements = extractRequirements(job);
  return { job, requirements, assessments: requirements.map((req) => assessRequirement(resume, req)) };
}

function judge(resume: Resume, req: Requirement): [Verdict, string | null] {
  switch (req.kind) {
    case "skill": {
      const hit = req.anyOf.find((s) => resume.skills.includes(s));
      if (hit) return ["meets", findSkillLine(resume.rawText, hit)];
      const related = req.anyOf.flatMap((s) => RELATED_SKILLS[s] ?? []).find((s) => resume.skills.includes(s));
      if (related) return ["unclear", `Related: ${findSkillLine(resume.rawText, related) ?? related}`];
      return ["does_not_meet", null];
    }
    case "education": {
      const evidence = `Highest degree: ${resume.degree}`;
      if (degreeRank(resume.degree) >= degreeRank(req.minDegree)) return ["meets", evidence];
      return [req.orEquivalentExperience ? "unclear" : "does_not_meet", evidence];
    }
    case "experience": {
      const have = resume.yearsExperience;
      const evidence = `${have} years in technical roles`;
      if (have >= req.minYears) return ["meets", evidence];
      return [req.minYears - have <= BORDERLINE_YEARS ? "unclear" : "does_not_meet", evidence];
    }
    case "eligibility": {
      const stated = resume.eligibility[req.eligibility];
      if (stated !== undefined) return [stated ? "meets" : "does_not_meet", "Stated on resume"];
      return [SILENCE_MEANS_NO.has(req.eligibility) ? "does_not_meet" : "unclear", "Not stated on resume"];
    }
    case "other":
      // Rules can't read "strong communication skills". Yellow is the honest answer.
      return ["unclear", null];
  }
}
