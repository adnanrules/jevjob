// Rule-based requirement extraction: posting text → Requirement[].
// Only bullets under a requirements-style header count. "What you'll do" bullets describe the job,
// not the candidate, so they're skipped.
import type { Importance, RawJob, Requirement } from "../domain";
import { findSkills } from "../skills";
import { normalizePosting } from "./posting";
import { findDegrees, findEligibility, findMinYears } from "./patterns";

// Keywords can sit anywhere in a header: real postings say things like
// "Your Skills & Abilities (Required Qualifications)". Only short lines count as headers, so a paragraph
// that happens to contain "required" can't open a requirements section.
const REQUIRED_HEADER =
  /\b(requirements|qualifications|required|what you('ll)? need|you have|must[- ]haves?|skills|who you are)\b/i;
const PREFERRED_HEADER = /\b(nice[- ]to[- ]haves?|preferred|bonus|desired|pluses|a plus|may have|top candidates|ideal(ly)?|stand out)\b/i;
const MAX_HEADER_LENGTH = 90;
// "-", "*" and "–" need a space after them ("**Bold**" isn't a bullet); "●Line" often has none.
const BULLET = /^(?:[-*–]\s+|[•●▪◦‣]\s*)/;

/**
 * Requirements from a posting's headers and bullets. Postings whose list markup was stripped (job boards, copied
 * pages) get a second pass on the normalized text, where headers and bullets have been rebuilt.
 */
export function extractRequirements(job: RawJob): Requirement[] {
  const direct = extractFrom(job.description, job.id);
  const required = (reqs: Requirement[]) => reqs.filter((r) => r.importance === "required").length;
  if (required(direct) >= 3) return direct;
  const rebuilt = extractFrom(normalizePosting(job.description), job.id);
  return required(rebuilt) > required(direct) ? rebuilt : direct;
}

function extractFrom(description: string, jobId: string): Requirement[] {
  const requirements: Requirement[] = [];
  let section: Importance | null = null;

  for (const raw of description.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (!BULLET.test(line)) {
      // A non-bullet line ends the current list. If it's a short header, it may open a new one.
      // Check "preferred" first: "Preferred qualifications" also contains "qualifications".
      const header = line.length <= MAX_HEADER_LENGTH && !/[.!?]$/.test(line);
      section = !header ? null : PREFERRED_HEADER.test(line) ? "preferred" : REQUIRED_HEADER.test(line) ? "required" : null;
      continue;
    }
    if (section) requirements.push(...fromLine(line.replace(BULLET, ""), section, jobId, requirements.length));
  }
  return requirements;
}

/**
 * Turns lines someone else classified (Jev, in the extraction cascade) into requirements, with the same
 * per-line parsing the header-based extractor uses.
 */
export function requirementsFromLines(lines: Array<{ text: string; importance: Importance }>, jobId: string): Requirement[] {
  const requirements: Requirement[] = [];
  for (const { text, importance } of lines) requirements.push(...fromLine(text, importance, jobId, requirements.length));
  return requirements;
}

/**
 * Every line of a posting that could be a qualification, for a classifier to sort out when the posting has no
 * recognizable requirements header. Bullets first; if a posting barely uses bullets, its sentences too.
 */
export function candidateLines(description: string, max = 70): string[] {
  const lines = normalizePosting(description).split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => BULLET.test(l)).map((l) => l.replace(BULLET, "").trim());
  const sentences =
    bullets.length >= 5
      ? []
      : lines
          .filter((l) => !BULLET.test(l) && l.length > MAX_HEADER_LENGTH)
          .flatMap((l) => l.split(/(?<=[.;])\s+(?=[A-Z])/))
          .map((s) => s.trim());
  const usable = [...bullets, ...sentences].filter((l) => l.length >= 8 && l.length <= 300);
  return [...new Set(usable)].slice(0, max);
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
