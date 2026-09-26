import { describe, expect, it } from "vitest";
import { dropStale, normalizeJobs } from "../src/ingest";
import { jobs } from "./helpers";

const longText = "Requirements\n- Python\n- SQL\n- A bachelor's degree in computer science";

describe("normalizeJobs", () => {
  it("accepts JevJob's own shape unchanged", () => {
    expect(normalizeJobs(jobs)).toEqual({ jobs, rejected: [] });
  });

  it("maps Joboid's shape (apply_url, posted) onto RawJob", () => {
    const { jobs: out } = normalizeJobs([{
      id: "acme:greenhouse:1", company: "Acme", title: "SWE", location: "Chicago, IL",
      apply_url: "https://boards.greenhouse.io/acme/jobs/1", posted: "2026-09-20", description: longText, fit: { score: 1 },
    }]);
    expect(out[0]).toEqual({
      id: "acme:greenhouse:1", company: "Acme", title: "SWE", location: "Chicago, IL",
      applyUrl: "https://boards.greenhouse.io/acme/jobs/1", postedAt: "2026-09-20", description: longText,
    });
  });

  it("rejects, with a reason, postings that would be unsafe or useless", () => {
    const { jobs: out, rejected } = normalizeJobs([
      { id: "a", company: "A", title: "T", applyUrl: "javascript:alert(1)", description: longText },
      { id: "b", company: "B", title: "T", apply_url: "https://b.example/1", description: "" },
      { id: "c", company: "C", title: "T", applyUrl: "https://c.example/1", description: longText },
      { id: "c", company: "C", title: "T", applyUrl: "https://c.example/1", description: longText },
    ]);
    expect(out.map((j) => j.id)).toEqual(["c"]);
    expect(rejected.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rejected[1]!.reason).toMatch(/no description/);
  });

  it("rejects closed postings, which is what 'stale' really means", () => {
    const { rejected } = normalizeJobs([
      { id: "x", company: "X", title: "T", apply_url: "https://x.example/1", description: longText, still_open: false },
    ]);
    expect(rejected[0]!.reason).toBe("posting is closed");
  });
});

describe("dropStale", () => {
  it("drops old postings but keeps undated ones", () => {
    const base = { company: "X", title: "T", location: "", applyUrl: "https://x.example", description: longText };
    const { kept, dropped } = dropStale(
      [{ ...base, id: "new", postedAt: "2026-09-20" }, { ...base, id: "old", postedAt: "2026-06-01" }, { ...base, id: "undated" }],
      45,
      new Date("2026-09-26"),
    );
    expect(kept.map((j) => j.id)).toEqual(["new", "undated"]);
    expect(dropped.map((j) => j.id)).toEqual(["old"]);
  });
});
