// Everything the start screen needs: sample resumes, whether Jev is configured, and where jobs come from.
import { jevAvailable, jevModel, loadJobs, loadSamples } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const { source, jobs } = loadJobs();
  return Response.json({
    samples: loadSamples(),
    jev: jevAvailable() ? { model: jevModel() } : null,
    source,
    jobCount: jobs.length,
  });
}
