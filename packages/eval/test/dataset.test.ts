import { describe, expect, it } from "vitest";
import { TIER_ORDER } from "@jevjob/core";
import { loadDataset } from "../src/dataset";

// Guards against typos in hand-written labels, which would otherwise silently count as model errors.
describe("eval dataset", () => {
  const data = loadDataset();

  it("every case points at a real resume and job", () => {
    for (const c of data.cases) {
      expect(data.resumes.has(c.resume), c.id).toBe(true);
      expect(data.jobs.has(c.job), c.id).toBe(true);
    }
  });

  it("has no duplicate cases and only valid tiers", () => {
    expect(new Set(data.cases.map((c) => c.id)).size).toBe(data.cases.length);
    for (const c of data.cases) expect(TIER_ORDER).toContain(c.tier);
  });

  it("every check quotes text that really appears in its posting", () => {
    for (const c of data.cases) {
      const description = data.jobs.get(c.job)!.description.toLowerCase();
      for (const check of c.checks) expect(description, `${c.id}: "${check.requirement}"`).toContain(check.requirement.toLowerCase());
    }
  });

  it("only uses reserved .example domains", () => {
    for (const job of data.jobs.values()) expect(new URL(job.applyUrl).hostname).toMatch(/\.example$/);
  });
});
