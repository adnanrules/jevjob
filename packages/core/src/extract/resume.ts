// Rule-based resume parsing: markdown/plain text → Resume.
import type { Resume, Role } from "../domain";
import { findSkills } from "../skills";
import { findDegrees } from "./patterns";

export interface ParseResumeOptions {
  /** "Now" for roles ending in "Present". Pass it in tests so results don't change with the calendar. */
  asOf?: Date;
}

export function parseResume(rawText: string, { asOf = new Date() }: ParseResumeOptions = {}): Resume {
  const roles = parseRoles(section(rawText, "experience") ?? "", asOf);
  return {
    rawText,
    skills: findSkills(rawText),
    degree: findDegrees(section(rawText, "education") ?? rawText).at(-1) ?? "none",
    roles,
    yearsExperience: yearsOf(roles.filter((r) => TECHNICAL_TITLE.test(r.title))),
    eligibility: statedEligibility(rawText),
  };
}

/**
 * Years covered by a set of roles. Overlapping months count once, so a TA job held during
 * an internship doesn't double the total.
 */
export function yearsOf(roles: Role[]): number {
  const months = new Set<number>();
  for (const role of roles) for (let m = role.startMonth; m <= role.endMonth; m++) months.add(m);
  return Math.round((months.size / 12) * 100) / 100;
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
// The rules' crude stand-in for "is this the right kind of work?". Jev replaces it with a question per role.
const TECHNICAL_TITLE = /engineer|developer|programmer|intern|analyst|scientist|architect|devops/i;

/** A role starts at a line with a date range; its bullets follow until the next role. */
function parseRoles(experience: string, asOf: Date): Role[] {
  const roles: Role[] = [];
  for (const line of experience.split("\n")) {
    const range = DATE_RANGE.exec(line);
    if (range) {
      const startMonth = monthIndex(range[1], range[2]);
      const endMonth = range[3] ? monthIndex(range[3], range[4]) : asOf.getFullYear() * 12 + asOf.getMonth();
      if (startMonth === null || endMonth === null || endMonth < startMonth) continue;
      const title = line.replaceAll("*", "").split(",")[0]?.trim() ?? "";
      roles.push({ title, text: line.replaceAll("**", "").trim(), startMonth, endMonth });
    } else if (/^\s*[-*•]\s/.test(line) && roles.length > 0) {
      roles[roles.length - 1]!.text += `\n${line.trim()}`;
    }
  }
  return roles;
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
