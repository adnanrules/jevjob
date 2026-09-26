import { createHash } from "node:crypto";
import type { RawJob } from "@jevjob/core";
import { searchDays, validatePlan, type SearchPlan } from "./intent";
import { areaFit, searchAreas, type SearchArea } from "./geography";
import { loadEnv } from "./paths";
import { canonicalUrl, parsePosting, type ParsedPosting, type WebResult } from "./posting";
import { fetchPublicPage } from "./public-page";
import { earlyTitleMismatch, jobFitIssue } from "./search-quality";
import { sourceAllowed, sourceDomains, sourceKind } from "./search-sources";
import { ashbyReader } from "./ashby";

export interface SearchDiagnostics {
  provider: "exa";
  queries: string[];
  examined: number;
  skipped: Record<string, number>;
  warnings: string[];
  /** This is a bounded web search, not proof that the public web is exhausted. */
  limited: boolean;
  nextRound: number;
  areasSearched: string[];
  matchesByArea: Record<string, number>;
  sourceCounts?: Record<string, number>;
  performance?: { elapsedMs: number; searchMs: number; pageFetches: number; cacheHits: number; prefiltered: number };
}
export interface SearchBatch extends SearchDiagnostics { jobs: RawJob[] }
export interface ExaDependencies {
  search: (body: Record<string, unknown>) => Promise<WebResult[]>;
  page: (url: string) => Promise<string>;
  now: () => number;
  ats?: (url: string, now: number) => Promise<ParsedPosting | null>;
}

export function exaAvailable(): boolean { loadEnv(); return Boolean(process.env.EXA_API_KEY?.trim()); }

async function search(body: Record<string, unknown>): Promise<WebResult[]> {
  loadEnv();
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) throw new Error("Public search requires EXA_API_KEY in JevJob's .env or environment. Use provider=joboid only if you want tracked-company search.");
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const hint = response.status === 401 ? "Check EXA_API_KEY." : response.status === 402 ? "Exa credits are exhausted." : response.status === 429 ? "Exa rate limit reached; try later." : "Try again later.";
    // Never include response bodies or credentials in errors.
    throw new Error(`Exa search HTTP ${response.status}. ${hint}`);
  }
  const data = await response.json() as { results?: unknown };
  if (!Array.isArray(data.results)) throw new Error("Exa returned an invalid search response.");
  return data.results.filter((row): row is WebResult => Boolean(row) && typeof row === "object" && typeof row.url === "string")
    .map((row) => ({ url: row.url, ...(typeof row.title === "string" ? { title: row.title } : {}), ...(typeof row.text === "string" ? { text: row.text } : {}) }));
}

/** Exact normalized employer/title/location matches collapse mirrored board listings conservatively. */
export function postingKey(job: RawJob): string {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `posting:${[job.company, job.title, job.location].map(norm).join("|")}`;
}

export function queryFor(plan: SearchPlan, round: number, area: SearchArea = searchAreas(plan)[0]!): string {
  const title = plan.titles[round % plan.titles.length]!;
  const where = area.usRemoteOnly ? "the United States, remote work only" : area.locations.length
    ? `${area.locations.slice(0, 6).join(", ")}${area.remote ? " or remote" : ""}` : area.remote ? "remote" : "any location";
  const level = plan.level === "entry" ? "entry level junior" : plan.level === "any" ? "" : plan.level;
  const days = searchDays(plan);
  const angle = [
    "Individual job openings on public job boards or employer careers pages. Prefer original employer listings with a named hiring company, qualifications and application details; not training programs or copied job roundups.",
    "Current job openings on public job boards, with the hiring employer, job description and how to apply.",
    "An employer careers page advertising this role, describing responsibilities and qualifications and accepting applications.",
  ][Math.floor(round / plan.titles.length) % 3];
  return `${level} ${title} ${plan.internships ? "including internships" : "jobs"} in ${where}. ${angle}${days ? ` Posted in the last ${days} days.` : ""}`.trim();
}

export async function collectPublicJobs(
  plan: SearchPlan,
  { seen = new Set<string>(), round = 0, maxQueries = 5 }: { seen?: Set<string>; round?: number; maxQueries?: number } = {},
  deps: ExaDependencies = { search, page: fetchPublicPage, now: Date.now, ats: ashbyReader() },
): Promise<SearchBatch> {
  validatePlan(plan);
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 6) throw new Error("maxQueries must be an integer from 1 to 6.");
  const now = deps.now();
  const started = performance.now();
  const metrics = { elapsedMs: 0, searchMs: 0, pageFetches: 0, cacheHits: 0, prefiltered: 0 };
  const days = searchDays(plan);
  const cutoff = days ? now - days * 86_400_000 : undefined;
  const output: SearchBatch = { provider: "exa", jobs: [], queries: [], examined: 0, skipped: {}, warnings: [], limited: false, nextRound: round, areasSearched: [], matchesByArea: {} };
  const skip = (reason: string) => { output.skipped[reason] = (output.skipped[reason] ?? 0) + 1; };
  const urls = new Set<string>();
  const pages = new Map<string, ParsedPosting>();
  const accepted = new Set(seen);
  const areas = searchAreas(plan);
  const domains = sourceDomains(plan.sources);
  for (let step = 0; step < maxQueries && output.jobs.length < plan.count; step++) {
    const area = areas[(round + step) % areas.length]!;
    const query = queryFor(plan, Math.floor((round + step) / areas.length), area);
    output.areasSearched.push(area.label);
    output.queries.push(query);
    let results: WebResult[];
    const searchStarted = performance.now();
    try {
      results = await deps.search({
        query, type: "auto", numResults: Math.min(50, Math.max(10, plan.count * 2)),
        contents: { text: { maxCharacters: 30_000 }, maxAgeHours: 24 },
        ...(domains ? { includeDomains: domains } : {}),
        ...(cutoff !== undefined ? { startPublishedDate: new Date(cutoff).toISOString(), endPublishedDate: new Date(now).toISOString() } : {}),
      });
    } catch (err) {
      if (step === 0) throw err; // Leave the current pool/session intact on failure.
      output.warnings.push(err instanceof Error ? err.message : "Search request failed.");
      break;
    } finally {
      metrics.searchMs += Math.round(performance.now() - searchStarted);
    }
    output.nextRound = round + step + 1;
    const candidates = results.filter((result) => {
      let url: string;
      try { url = canonicalUrl(result.url); } catch { skip("not a public HTTPS listing"); return false; }
      if (!sourceAllowed(url, plan.sources)) { skip("outside selected source policy"); metrics.prefiltered++; return false; }
      const id = `web:${createHash("sha256").update(url).digest("hex").slice(0, 24)}`;
      if (accepted.has(id) || earlyTitleMismatch(result.title ?? "", plan)) { skip("rejected before page fetch: seen or senior title"); metrics.prefiltered++; return false; }
      const areaUrl = `${area.label}|${url}`;
      if (urls.has(areaUrl)) { skip("duplicate URL"); return false; }
      urls.add(areaUrl);
      return true;
    }).sort((a, b) => Number(sourceKind(b.url) === "employer-board") - Number(sourceKind(a.url) === "employer-board"));
    for (let i = 0; i < candidates.length && output.jobs.length < plan.count; i += 5) {
      const parsed = await Promise.all(candidates.slice(i, i + 5).map(async (result) => {
        const url = canonicalUrl(result.url);
        if (pages.has(url)) { metrics.cacheHits++; return pages.get(url)!; }
        if (deps.ats) {
          try {
            const posting = await deps.ats(url, now);
            if (posting) { output.examined++; pages.set(url, posting); return posting; }
          } catch { skip("employer feed unavailable; tried public page"); }
        }
        let html = "";
        metrics.pageFetches++;
        try { html = await deps.page(result.url); } catch { skip("page unavailable; tried indexed text"); }
        output.examined++;
        const posting = parsePosting(result, html, now);
        pages.set(url, posting);
        return posting;
      }));
      for (const item of parsed) {
        if ("reason" in item) { skip(item.reason); continue; }
        const { job } = item;
        const key = postingKey(job);
        if (accepted.has(job.id) || accepted.has(key)) { skip("already seen or mirrored listing"); continue; }
        const issue = jobFitIssue(job, plan);
        if (issue) { skip(issue); continue; }
        if (!areaFit(job.location, area)) { skip("location mismatch or unverified"); continue; }
        if (cutoff !== undefined && (!job.postedAt || Date.parse(job.postedAt) < cutoff)) { skip("posting date missing or outside window"); continue; }
        if (output.jobs.length >= plan.count) break;
        accepted.add(job.id); accepted.add(key);
        output.jobs.push(job);
        output.sourceCounts ??= {};
        const kind = sourceKind(job.applyUrl);
        output.sourceCounts[kind] = (output.sourceCounts[kind] ?? 0) + 1;
        output.matchesByArea[area.label] = (output.matchesByArea[area.label] ?? 0) + 1;
      }
    }
  }
  output.limited = output.jobs.length < plan.count;
  metrics.elapsedMs = Math.round(performance.now() - started);
  output.performance = metrics;
  output.warnings.push("Public listings may be indexed or cached; availability and remote work eligibility must be checked on the linked posting.");
  if (output.limited) output.warnings.push("Requested count was not reached within this search budget. This does not mean there are no other jobs; use more to search additional title/location variants.");
  return output;
}
