// Rule-based resume parsing: markdown/plain text → Resume.
import type { Resume } from "../domain";
import { findSkills } from "../skills";
import { findDegrees } from "./patterns";

export interface ParseResumeOptions {
  /** "Now" for roles ending in "Present". Pass it in tests so results don't change with the calendar. */
  asOf?: Date;
}

export function parseResume(rawText: string, { asOf = new Date() }: ParseResumeOptions = {}): Resume {
  return {
    rawText,
    skills: findSkills(rawText),
    degree: findDegrees(section(rawText, "education") ?? rawText).at(-1) ?? "none",
    yearsExperience: technicalYears(section(rawText, "experience") ?? "", asOf),
    eligibility: statedEligibility(rawText),
  };
}

/** The body of a markdown section ("## Experience") up to the next header. */
function section(text: string, name: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^#{1,3}\\s*${name}\\b`, "i").test(l));
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_RANGE = /\b([a-z]{3})[a-z]*\.?\s+(\d{4})\s*[–—-]\s*(?:([a-z]{3})[a-z]*\.?\s+(\d{4})|present|current|now)/i;
// A TA job is real work, but it isn't what "2+ years of software experience" means. Only technical titles count.
const TECHNICAL_TITLE = /engineer|developer|programmer|intern|analyst|scientist|architect|devops/i;

/** Sums role lengths (inclusive months). Known gap: overlapping roles are double-counted. */
function technicalYears(experience: string, asOf: Date): number {
  let months = 0;
  for (const line of experience.split("\n")) {
    const range = DATE_RANGE.exec(line);
    const title = line.replaceAll("*", "").split(",")[0] ?? "";
    if (!range || !TECHNICAL_TITLE.test(title)) continue;
    const start = monthIndex(range[1], range[2]);
    const end = range[3] ? monthIndex(range[3], range[4]) : asOf.getFullYear() * 12 + asOf.getMonth();
    if (start !== null && end !== null) months += Math.max(0, end - start + 1);
  }
  return Math.round((months / 12) * 100) / 100;
}

function monthIndex(month: string | undefined, year: string | undefined): number | null {
  const i = MONTHS.indexOf((month ?? "").toLowerCase());
  return i === -1 || !year ? null : Number(year) * 12 + i;
}

/** Only records what the resume positively states. Never writes `false`: silence is "unknown". */
function statedEligibility(text: string): Resume["eligibility"] {
  const stated: Resume["eligibility"] = {};
  if (/\bU\.?S\.? citizen/i.test(text)) stated.us_citizenship = true;
  if (/\bclearance\b/i.test(text)) stated.security_clearance = true;
  if (/authori[sz]ed to work/i.test(text)) stated.work_authorization = true;
  return stated;
}
