// Cheap poll target: lets an open app notice when a harness loads a new pool.
import { loadJobs, poolVersion } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const { source, jobs } = loadJobs();
  return Response.json({ version: poolVersion(), source, jobCount: jobs.length });
}
