// Regexes shared by resume parsing and requirement extraction.
import { DEGREE_LEVELS, type DegreeLevel, type EligibilityKind } from "../domain";

// "MS"/"BS" are matched case-sensitively on purpose: lowercase "ms" is usually milliseconds.
const DEGREE_PATTERNS: Record<Exclude<DegreeLevel, "none">, RegExp[]> = {
  associate: [/\bassociate'?s? degree\b/i],
  bachelor: [/\bbachelor/i, /\b(?:B\.S\.|BS|B\.Sc\.?|B\.A\.|BA)(?![A-Za-z])/],
  master: [/\bmaster'?s?\b/i, /\b(?:M\.S\.|MS|M\.Sc\.?|MEng|MBA)(?![A-Za-z])/],
  phd: [/\bph\.?\s?d\b/i, /\bdoctorate\b/i],
};

/** Every degree level mentioned, lowest first ("MS or PhD" → ["master", "phd"]). */
export function findDegrees(text: string): DegreeLevel[] {
  return DEGREE_LEVELS.filter((level) => level !== "none" && DEGREE_PATTERNS[level].some((re) => re.test(text)));
}

export const degreeRank = (degree: DegreeLevel) => DEGREE_LEVELS.indexOf(degree);

// "2+ years", "0-2 years", "3 to 5 years" → the first number is the minimum.
const YEARS = /(\d+)\s*(?:\+|(?:-|–|to)\s*\d+)?\s*\+?\s*years?/i;

export function findMinYears(text: string): number | null {
  const match = YEARS.exec(text);
  return match ? Number(match[1]) : null;
}

const ELIGIBILITY_PATTERNS: Array<[EligibilityKind, RegExp]> = [
  ["security_clearance", /\bclearance\b/i],
  ["us_citizenship", /\bcitizen(ship)?\b/i],
  ["work_authorization", /authori[sz](ed|ation) to work|work authori[sz]ation|visa sponsorship/i],
  // A driver's license isn't a professional license (held-out bug: it became a false blocker).
  ["professional_license", /(?<!driver['’]?s\s|driving\s)\blicen[sc](e|ed|ure)\b/i],
];

export function findEligibility(text: string): EligibilityKind | null {
  return ELIGIBILITY_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null;
}
