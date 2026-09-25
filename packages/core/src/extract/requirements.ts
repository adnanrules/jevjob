// Rule-based requirement extraction: posting text → Requirement[].
// Only bullets under a requirements-style header count. "What you'll do" bullets describe the job,
// not the candidate, so they're skipped.
import type { Importance, RawJob, Requirement } from "../domain";
import { findSkills } from "../skills";
import { findDegrees, findEligibility, findMinYears } from "./patterns";

const REQUIRED_HEADER =
  /^(requirements|qualifications|minimum qualifications|basic qualifications|required|what you('ll)? need|you have)\b/i;
const PREFERRED_HEADER = /^(nice to have|preferred|bonus|desired|pluses)\b/i;
const BULLET = /^[-*•]\s+/;

export function extractRequirements(job: RawJob): Requirement[] {
  const requirements: Requirement[] = [];
  let section: Importance | null = null;

  for (const raw of job.description.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (!BULLET.test(line)) {
      // Any non-bullet line is a header. Check "preferred" first: "Preferred qualifications" contains "qualifications".
      section = PREFERRED_HEADER.test(line) ? "preferred" : REQUIRED_HEADER.test(line) ? "required" : null;
      continue;
    }
    if (section) requirements.push(...fromLine(line.replace(BULLET, ""), section, job.id, requirements.length));
  }
  return requirements;
}

/**
 * One bullet can hold several requirements: "7+ years of C++" is an experience bar AND a skill.
 * So a line yields at most one eligibility/experience/education requirement, plus its skills.
 */
function fromLine(text: string, importance: Importance, jobId: string, countSoFar: number): Requirement[] {
  let n = countSoFar;
  const base = () => ({ id: `${jobId}#r${++n}`, text, importance });
  const out: Requirement[] = [];

  const eligibility = findEligibility(text);
  const minYears = findMinYears(text);
  const degrees = findDegrees(text);
  if (eligibility) out.push({ ...base(), kind: "eligibility", eligibility });
  else if (minYears !== null) out.push({ ...base(), kind: "experience", minYears });
  else if (degrees.length > 0 || /\bdegree\b/i.test(text)) {
    out.push({
      ...base(),
      kind: "education",
      minDegree: degrees[0] ?? "bachelor",
      orEquivalentExperience: /\bequivalent\b/i.test(text),
    });
  }

  // "Java or Python" → one requirement either satisfies. "TypeScript and React" → two separate ones.
  const skills = findSkills(text);
  if (skills.length > 0 && /\bor\b/i.test(text)) out.push({ ...base(), kind: "skill", anyOf: skills });
  else for (const skill of skills) out.push({ ...base(), kind: "skill", anyOf: [skill] });

  if (out.length === 0) out.push({ ...base(), kind: "other" });
  return out;
}
