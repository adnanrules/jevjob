import type { RawJob } from "@jevjob/core";

/**
 * For jobs the search only found by widening the "posted within" window: a short tag for the row and a full
 * sentence for the tooltip and detail view. Null for jobs inside the window the user asked for.
 */
export function windowNote(job: RawJob): { short: string; long: string } | null {
  if (!job.outsideWindowDays) return null;
  const asked = job.outsideWindowDays;
  const age = job.postedAt ? Math.max(0, Math.round((Date.now() - Date.parse(job.postedAt)) / 86_400_000)) : null;
  return {
    short: age === null ? `outside ${asked}d` : `${age}d · outside ${asked}d`,
    long: `${age === null ? "Posted" : `Posted ${age} days ago,`} outside your ${asked}-day window: added because the search ran short.`,
  };
}
