// Job ingestion: anything a harness hands us → validated RawJob[].
// Accepts JevJob's own shape and Joboid's `joboid job <id>` shape. Everything from outside is untrusted:
// it's validated, and apply links must be http(s) so a posting can't smuggle in a javascript: URL.
import { z } from "zod";
import type { RawJob } from "./domain";

const httpUrl = z.url({ protocol: /^https?$/ });

const JevJobShape = z.object({
  id: z.string().min(1),
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().default(""),
  applyUrl: httpUrl,
  postingUrl: httpUrl.optional(),
  postedAt: z.string().optional(),
  pay: z.string().max(120).optional(),
  description: z.string(),
});

const JoboidShape = z.object({
  id: z.string().min(1),
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().nullish(),
  apply_url: httpUrl.nullish(),
  posting_url: httpUrl.nullish(),
  posted: z.string().nullish(),
  description: z.string().nullish(),
  still_open: z.boolean().nullish(),
});

export interface IngestResult {
  jobs: RawJob[];
  rejected: Array<{ index: number; id: string | null; reason: string }>;
}

/** Validates and normalizes a batch. Bad items are reported, never silently dropped or half-imported. */
export function normalizeJobs(input: unknown): IngestResult {
  const items: unknown[] = Array.isArray(input) ? input : [input];
  const result: IngestResult = { jobs: [], rejected: [] };
  const seen = new Set<string>();

  items.forEach((item, index) => {
    const id = typeof (item as { id?: unknown })?.id === "string" ? (item as { id: string }).id : null;
    const reject = (reason: string) => result.rejected.push({ index, id, reason });

    const job = toRawJob(item);
    if (typeof job === "string") return reject(job);
    if (job.description.trim().length < 40) return reject("no description; fetch the full posting first (e.g. `joboid job <id>`)");
    if (seen.has(job.id)) return reject("duplicate id in this batch");
    seen.add(job.id);
    result.jobs.push(job);
  });
  return result;
}

function toRawJob(item: unknown): RawJob | string {
  const ours = JevJobShape.safeParse(item);
  if (ours.success) {
    const { postedAt, postingUrl, pay, ...rest } = ours.data;
    return { ...rest, ...(postingUrl && { postingUrl }), ...(postedAt && { postedAt }), ...(pay && { pay }) };
  }
  const joboid = JoboidShape.safeParse(item);
  if (joboid.success) {
    const j = joboid.data;
    // "Old info" means closed, not old: plenty of two-month-old postings are still hiring.
    if (j.still_open === false) return "posting is closed";
    const applyUrl = j.apply_url ?? j.posting_url;
    if (!applyUrl) return "no http(s) apply link";
    const postedAt = /^\d{4}-\d{2}-\d{2}$/.test(j.posted ?? "") ? j.posted! : undefined;
    const job: RawJob = { id: j.id, company: j.company, title: j.title, location: j.location ?? "", applyUrl, description: j.description ?? "" };
    const postingUrl = j.posting_url && j.posting_url !== applyUrl ? j.posting_url : undefined;
    return { ...job, ...(postingUrl && { postingUrl }), ...(postedAt && { postedAt }) };
  }
  return ours.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).slice(0, 3).join("; ");
}

/** Drops postings older than `maxAgeDays`. Postings without a date are kept: unknown age isn't "old". */
export function dropStale(jobs: RawJob[], maxAgeDays: number, today = new Date()): { kept: RawJob[]; dropped: RawJob[] } {
  const cutoff = today.getTime() - maxAgeDays * 86_400_000;
  const kept: RawJob[] = [];
  const dropped: RawJob[] = [];
  for (const job of jobs) (job.postedAt && Date.parse(job.postedAt) < cutoff ? dropped : kept).push(job);
  return { kept, dropped };
}
