import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawJob } from "@jevjob/core";
import type { SearchBatch } from "../src/exa";

const mocks = vi.hoisted(() => ({ collect: vi.fn(), tracked: vi.fn(), moreTracked: vi.fn(), dir: "" }));
vi.mock("../src/paths", async (original) => {
  const actual = await original<typeof import("../src/paths")>();
  const fs = await import("node:fs");
  const os = await import("node:os");
  const p = await import("node:path");
  mocks.dir = fs.mkdtempSync(p.join(os.tmpdir(), "jevjob-session-test-"));
  return { ...actual, SESSION_FILE: p.join(mocks.dir, "session.json"), JOBS_FILE: p.join(mocks.dir, "jobs.json") };
});
vi.mock("../src/exa", async (original) => ({ ...await original<typeof import("../src/exa")>(), collectPublicJobs: mocks.collect }));
vi.mock("../src/joboid", () => ({ findJobs: mocks.tracked, moreJobs: mocks.moreTracked }));

import { findJobs, moreJobs } from "../src/search";
import { currentJobs } from "../src/jobs";
const job: RawJob = { id: "web:1", title: "Software Engineer", company: "Example Employer", location: "Chicago, IL", description: "Build applications and work with the software team. Python and SQL required.", applyUrl: "https://example.com/jobs/1" };
const batch = (jobs: RawJob[] = [job], nextRound = 1): SearchBatch => ({ jobs, provider: "exa", queries: ["a public search"], examined: 1, skipped: {}, warnings: [], limited: false, nextRound, areasSearched: ["Chicago"], matchesByArea: { Chicago: jobs.length } });
beforeEach(() => {
  vi.clearAllMocks();
  rmSync(path.join(mocks.dir, "jobs.json"), { force: true });
  rmSync(path.join(mocks.dir, "session.json"), { force: true });
  mocks.collect.mockResolvedValue(batch());
});
afterAll(() => rmSync(mocks.dir, { recursive: true, force: true }));

describe("public search sessions", () => {
  it("defaults to Exa, stores filters, and passes seen identities and a new query round to more", async () => {
    await findJobs("software engineer in Chicago, last 7 days");
    expect(mocks.tracked).not.toHaveBeenCalled();
    mocks.collect.mockResolvedValueOnce(batch([{ ...job, id: "web:2", company: "Second Employer" }], 2));
    await moreJobs();
    expect(mocks.collect.mock.calls[1]![1]).toMatchObject({ round: 1, seen: expect.any(Set) });
    expect(mocks.collect.mock.calls[1]![1].seen.has(job.id)).toBe(true);
    expect(currentJobs().jobs.map((j) => j.id)).toEqual(["web:2"]);
    expect(JSON.parse(readFileSync(path.join(mocks.dir, "session.json"), "utf8")).seen).toContain("web:1");
  });
  it("preserves useful results on an empty new search but continues the new filters", async () => {
    await findJobs("software engineer in Chicago");
    mocks.collect.mockResolvedValue(batch([], 3));
    await findJobs("data analyst in Boston");
    expect(currentJobs().jobs).toHaveLength(1);
    await moreJobs();
    expect(mocks.collect.mock.lastCall![0].titles).toContain("data analyst");
  });
  it("leaves the pool and session untouched on provider failure", async () => {
    await findJobs("software engineer in Chicago");
    const before = readFileSync(path.join(mocks.dir, "session.json"), "utf8");
    mocks.collect.mockRejectedValueOnce(new Error("Exa search HTTP 401"));
    await expect(findJobs("data analyst in Boston")).rejects.toThrow("401");
    expect(readFileSync(path.join(mocks.dir, "session.json"), "utf8")).toBe(before);
    expect(currentJobs().jobs).toEqual([job]);
  });
  it("retains plans on keep and does not mix providers in the same session", async () => {
    await findJobs("software engineer in Chicago");
    mocks.collect.mockResolvedValueOnce(batch([{ ...job, id: "web:2", company: "Second Employer" }]));
    await findJobs("software engineer remote", { keep: true });
    const saved = JSON.parse(readFileSync(path.join(mocks.dir, "session.json"), "utf8"));
    expect(saved.plans).toHaveLength(2);
    expect(currentJobs().jobs).toHaveLength(2);
    await expect(findJobs("engineer", { provider: "joboid", keep: true })).rejects.toThrow("switching providers");
  });
  it("requires an explicit opt-in for tracked-company searches", async () => {
    mocks.tracked.mockResolvedValue({ added: 0 });
    await findJobs("software engineer", { provider: "joboid" });
    expect(mocks.tracked).toHaveBeenCalledOnce();
    expect(mocks.collect).not.toHaveBeenCalled();
  });
});
