// Rule-based resume parsing: markdown or plain text (including text pulled out of PDF/DOCX) → Resume.
import type { Resume, Role } from "../domain";
import { findSkills } from "../skills";
import { findDegrees } from "./patterns";

export interface ParseResumeOptions {
  /** "Now" for roles ending in "Present". Pass it in tests so results don't change with the calendar. */
  asOf?: Date;
}

export function parseResume(rawText: string, { asOf = new Date() }: ParseResumeOptions = {}): Resume {
  const text = rawText.replace(/\r\n?/g, "\n");
  const roles = parseRoles(section(text, "experience") ?? "", asOf);
  return {
    rawText,
    skills: findSkills(text),
    degree: findDegrees(section(text, "education") ?? text).at(-1) ?? "none",
    roles,
    yearsExperience: yearsOf(roles.filter((r) => TECHNICAL_TITLE.test(r.title))),
    eligibility: statedEligibility(text),
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

// ── Sections ────────────────────────────────────────────────────────────────
// Markdown resumes say "## Experience"; PDFs and Word files say "PROFESSIONAL EXPERIENCE" on a line of its own.

const SECTIONS: Record<string, RegExp> = {
  experience: /^(professional |work |relevant |industry )?(experience|employment( history)?|work history)$/i,
  education: /^(education|academic background)( and training)?$/i,
};
// Any of these on a line of its own ends the section before it.
const OTHER_SECTION = /^(technical |core )?(skills|projects|personal projects|summary|profile|objective|certifications?|licenses( and certifications)?|awards|honors|leadership|activities|publications|volunteer(ing)?|interests|coursework|relevant coursework|languages|references)$/i;

function headerName(line: string): string | null {
  const bare = line.replace(/^#{1,3}\s*/, "").replace(/[:：]\s*$/, "").replace(/\*\*/g, "").trim();
  return bare.length > 0 && bare.length <= 40 ? bare : null;
}

function isHeader(line: string): boolean {
  if (/^#{1,3}\s/.test(line)) return true;
  const name = headerName(line);
  return name !== null && (OTHER_SECTION.test(name) || Object.values(SECTIONS).some((re) => re.test(name)));
}

/** The body of a section (e.g. experience) up to the next header, or null if the resume doesn't have one. */
function section(text: string, key: keyof typeof SECTIONS): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => {
    const name = headerName(l.trim());
    return name !== null && SECTIONS[key]!.test(name);
  });
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && isHeader(l.trim()));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

// ── Roles ───────────────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE = String.raw`(?:([a-z]{3})[a-z]*\.?\s+(\d{4})|(\d{1,2})\/(\d{4}))`;
const DATE_RANGE = new RegExp(`\\b${DATE}\\s*(?:[–—-]|to)\\s*(?:${DATE}|(present|current|now))`, "i");
// "-", "*" and "–" need a space after them, or "**Bold title**" would read as a bullet; "●Built" often has none.
const BULLET = /^\s*(?:[-*–]\s+|[•●▪◦‣]\s*)/;
// The rules' crude stand-in for "is this the right kind of work?". Jev replaces it with a question per role.
const TECHNICAL_TITLE = /engineer|developer|programmer|intern|analyst|scientist|architect|devops/i;

/**
 * A role is a dated header plus the bullets under it. Three layouts are handled:
 *   "Title, Company. Jun 2025 – Aug 2025"          (dates on the title line)
 *   "Title" / "Company | 06/2025 – 08/2025"         (title on the line above)
 *   "Aug 2020 – Feb 2025" … later "Title" + bullets (Word templates with dates in a separate text box:
 *                                                    detached dates are claimed, in order, by headed bullet lists)
 */
function parseRoles(experience: string, asOf: Date): Role[] {
  const roles: Role[] = [];
  const detached: Array<[number, number]> = [];
  const lines = experience.split("\n").map((l) => l.trim());
  const nextLine = (i: number) => lines.slice(i + 1).find((l) => l) ?? "";
  let current: Role | null = null;

  lines.forEach((line, i) => {
    if (!line) return;
    if (BULLET.test(line)) {
      if (current) current.text += `\n- ${line.replace(BULLET, "")}`;
      return;
    }

    const range = DATE_RANGE.exec(line);
    if (range) {
      const startMonth = monthIndex(range[1] ?? range[3], range[2] ?? range[4], Boolean(range[3]));
      const endMonth = range[9]
        ? asOf.getFullYear() * 12 + asOf.getMonth()
        : monthIndex(range[5] ?? range[7], range[6] ?? range[8], Boolean(range[7]));
      if (startMonth === null || endMonth === null || endMonth < startMonth) return;

      const header = line.replaceAll("**", "");
      const above = titleAbove(lines, i);
      const ownText = header.replace(DATE_RANGE, "").replace(/[\s|·,–—-]+/g, " ").trim();
      if (!above && ownText.length < 3) {
        detached.push([startMonth, endMonth]); // just dates: a title will show up later
        current = null;
        return;
      }
      current = { title: titleOf(above ?? header.replace(DATE_RANGE, "")), text: above ? `${above}\n${header}` : header, startMonth, endMonth };
      roles.push(current);
      return;
    }

    // An undated line heading a bullet list claims the next detached date range.
    if (detached.length > 0 && line.length <= 90 && BULLET.test(nextLine(i))) {
      const [startMonth, endMonth] = detached.shift()!;
      current = { title: titleOf(line), text: line.replaceAll("**", ""), startMonth, endMonth };
      roles.push(current);
    }
  });
  return roles;
}

const titleOf = (header: string) => header.split(/,| \| | — | – | at /)[0]!.replace(/\*/g, "").trim();

/** The line right above a date line (skipping one blank), if it looks like a job title rather than a bullet or sentence. */
function titleAbove(lines: string[], i: number): string | null {
  let j = i - 1;
  if (j >= 0 && !lines[j]) j--;
  const candidate = j >= 0 ? lines[j]!.replaceAll("**", "").trim() : "";
  const looksLikeTitle =
    candidate.length > 1 && candidate.length <= 60 && !BULLET.test(candidate) && !DATE_RANGE.test(candidate) && !/[.!?]$/.test(candidate);
  return looksLikeTitle ? candidate : null;
}

function monthIndex(month: string | undefined, year: string | undefined, numeric: boolean): number | null {
  if (!month || !year) return null;
  const i = numeric ? Number(month) - 1 : MONTHS.indexOf(month.toLowerCase());
  return i < 0 || i > 11 ? null : Number(year) * 12 + i;
}

/** Only records what the resume positively states. Never writes `false`: silence is "unknown". */
function statedEligibility(text: string): Resume["eligibility"] {
  const stated: Resume["eligibility"] = {};
  if (/\bU\.?S\.? citizen/i.test(text)) stated.us_citizenship = true;
  if (/\bclearance\b/i.test(text)) stated.security_clearance = true;
  if (/authori[sz]ed to work/i.test(text)) stated.work_authorization = true;
  return stated;
}
