// Platforms, not employers: every company's public board on these systems can be discovered.
export const EMPLOYER_BOARD_DOMAINS = [
  "jobs.lever.co", "jobs.eu.lever.co", "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.ashbyhq.com",
  "myworkdayjobs.com", "jobs.smartrecruiters.com", "icims.com", "apply.workable.com", "recruitee.com",
  "bamboohr.com", "careers.jobvite.com", "jobs.jobvite.com", "jobs.dayforcehcm.com", "careers.peopleclick.com",
];
export const JOB_BOARD_DOMAINS = ["indeed.com", "linkedin.com", "builtin.com", "dice.com", "glassdoor.com", "ziprecruiter.com", "wellfound.com"];
export type SearchSources = "recommended" | "employers" | "any";

export function sourceKind(value: string): "employer-board" | "job-board" | "other" {
  let host: string;
  try { host = new URL(value).hostname.toLowerCase(); } catch { return "other"; }
  const matches = (domains: string[]) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  return matches(EMPLOYER_BOARD_DOMAINS) ? "employer-board" : matches(JOB_BOARD_DOMAINS) ? "job-board" : "other";
}

export function sourceDomains(sources: SearchSources = "recommended"): string[] | undefined {
  return sources === "any" ? undefined : sources === "employers" ? EMPLOYER_BOARD_DOMAINS : [...EMPLOYER_BOARD_DOMAINS, ...JOB_BOARD_DOMAINS];
}

export function sourceAllowed(url: string, sources: SearchSources = "recommended"): boolean {
  const kind = sourceKind(url);
  return sources === "any" || kind === "employer-board" || sources === "recommended" && kind === "job-board";
}
