import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8");

describe("fixtures", () => {
  const jobs = JSON.parse(fixture("jobs.json")) as Array<{ id: string; applyUrl: string }>;
  const expected = JSON.parse(fixture("expected.json")) as { labels: Record<string, unknown> };

  it("has five postings, each with a label", () => {
    expect(jobs).toHaveLength(5);
    for (const job of jobs) expect(expected.labels).toHaveProperty([job.id]);
  });

  it("only uses reserved .example domains for apply links", () => {
    for (const job of jobs) expect(new URL(job.applyUrl).hostname).toMatch(/\.example$/);
  });

  it("has a resume", () => {
    expect(fixture("resume.jordan-rivera.md")).toContain("## Skills");
  });
});
