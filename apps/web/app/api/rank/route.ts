// Streams one event per pipeline step as it really happens, so the UI animates actual progress.
import { extractRequirements, parseResume, rulesAssessor } from "@jevjob/core";
import type { RankEvent } from "@/lib/events";
import { getAssessor, jevAvailable, jevModel, loadJobs, type AssessorName } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESUME_CHARS = 30_000;
const CONCURRENCY = 4;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { resume?: unknown; assessor?: unknown };
  // Don't trim the content itself: it's part of the Jev cache key, and the eval sends files untouched.
  const text = typeof body.resume === "string" ? body.resume : "";
  if (!text.trim()) return Response.json({ error: "Paste a resume first." }, { status: 400 });
  if (text.length > MAX_RESUME_CHARS) return Response.json({ error: "That resume is too long (30,000 characters max)." }, { status: 413 });

  const wanted: AssessorName = body.assessor === "jev" && jevAvailable() ? "jev" : "rules";
  const assessor = getAssessor(wanted);
  const resume = parseResume(text);
  const { source, jobs } = loadJobs();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RankEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      send({
        type: "start",
        assessor: wanted,
        model: wanted === "jev" ? jevModel() : null,
        source,
        jobs: jobs.map(({ id, company, title, location, applyUrl }) => ({ id, company, title, location, applyUrl })),
      });

      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const job = jobs[next++]!;
          send({ type: "parsed", id: job.id, requirements: extractRequirements(job).length });
          const started = performance.now();
          try {
            const result = await assessor.assess(resume, job);
            send({ type: "assessed", id: job.id, assessed: result.assessed, ms: performance.now() - started, cached: result.cached, fallback: false });
          } catch {
            // One failed Jev call shouldn't sink the board: this job falls back to the rules.
            const result = await rulesAssessor.assess(resume, job);
            send({ type: "assessed", id: job.id, assessed: result.assessed, ms: performance.now() - started, cached: false, fallback: true });
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      send({ type: "done", resume: { degree: resume.degree, skills: resume.skills, roles: resume.roles.length } });
      controller.close();
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
