import type { RawJob } from "@jevjob/core";
import { levelFit, titleFit, type SearchPlan } from "./intent";
import { plainText } from "./posting";

/** Source quality checks are content based, not a whitelist of companies or job boards. */
export function sourceIssue(job: RawJob): string | null {
  if (/^[\w.-]+\.[a-z]{2,}$/i.test(job.company.trim()) || /^(?:remote|online|global|worldwide)\b.*\b(?:jobs|careers|job board)$/i.test(job.company)) {
    return "hiring employer is a domain or generic job-board name";
  }
  const text = plainText(job.description);
  if (/\breputed company\b/i.test(text)) return "employer obscured in copied description";
  if (/\b(?:help(?:ed|s)? job\s?seekers get employed|get hired with a process|job placement (?:program|training)|training and placement program)\b/i.test(text)) {
    return "training or placement promotion rather than a specific opening";
  }
  return null;
}

/** Handles unbulleted and HTML listings without confusing company age with candidate experience. */
export function entryExperienceIssue(description: string): boolean {
  const text = plainText(description).replace(/[\u2010-\u2015]/g, "-");
  let preferred = false;
  for (const line of text.split(/\n|(?<=[.!?;])\s+(?=[A-Z])/)) {
    const trimmed = line.trim();
    if (trimmed.length < 100 && /^(?:preferred|desired|nice to have|bonus|what would make you stand out)\b/i.test(trimmed)) preferred = true;
    else if (trimmed.length < 100 && /^(?:required|requirements|qualifications|minimum|about|benefits|responsibilities)\b/i.test(trimmed)) preferred = false;
    for (const match of trimmed.matchAll(/\b(\d+)\s*(?:\+|(?:-|to)\s*\d+)?\s*\+?\s*years?\b/gi)) {
      if (Number(match[1]) < 3) continue;
      const before = trimmed.slice(Math.max(0, match.index - 90), match.index);
      const after = trimmed.slice(match.index + match[0].length, match.index + match[0].length + 100);
      if (!/\b(?:experience|building|developing|programming|engineering|working)\b/i.test(after)) continue;
      if (/\bexperience (?:and|with) (?:colleagues|offices|operations)\b/i.test(after)) continue;
      if (/\b(?:company|firm|organization|business|we have|our history|over the past|founded)\b/i.test(before)) continue;
      if (/\b(?:not required|no.{0,15}required|preferred|a plus|nice to have|desired)\b/i.test(after) || preferred && !/\b(?:required|must|minimum)\b/i.test(before + after)) continue;
      // A candidate-directed clause or standalone requirement; avoid long company-history paragraphs.
      if (match.index < 45 || /\b(?:you|candidate|applicant|requires?|minimum|at least|must)\b/i.test(before)) return true;
    }
  }
  return false;
}

export function jobFitIssue(job: RawJob, plan: SearchPlan): string | null {
  const source = sourceIssue(job);
  if (source) return source;
  if (!titleFit(job.title, plan) || levelFit(job.title, plan) === null) return "title or level mismatch";
  if (plan.level === "entry") {
    if (/\bseniority level\s*[:\n]?\s*(?:mid[-\s]*senior|senior|director)/i.test(job.description.replace(/[\u2010-\u2015]/g, "-"))) return "posting explicitly describes a senior role";
    if (entryExperienceIssue(job.description)) return "requires 3+ years of experience";
  }
  return null;
}

/** Only unequivocal senior title patterns are rejected before the expensive page request. */
export function earlyTitleMismatch(title: string, plan: SearchPlan): boolean {
  if (plan.level !== "entry") return false;
  const clean = title.replace(/^\[remote\]\s*/i, "");
  return /^(?:senior|sr\.?|staff|principal|lead|director)\s+(?:software|full[- ]?stack|backend|frontend|application|web|engineer|developer)/i.test(clean)
    || /\b(?:software|backend|frontend|full[- ]?stack)\s+(?:engineer|developer)\s+(?:[2-9]|[1-9]\d+|ii|iii|iv|v|vi|vii|viii|ix)\b/i.test(clean);
}
