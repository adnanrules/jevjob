import { describe, expect, it } from "vitest";
import { assessJob } from "../src/assess/rules";
import type { Tier } from "../src/domain";
import { parseResume } from "../src/extract/resume";
import { rankJobs, TIER_ORDER } from "../src/policy/rank";
import { fixture, jobs, resumeText } from "./helpers";

const resume = parseResume(resumeText, { asOf: new Date("2026-09-25") });
// Facts are computed ONCE. Every policy call below reuses them, just like the slider will.
const pool = jobs.map((job) => assessJob(resume, job));
const expected = JSON.parse(fixture("expected.json")) as {
  labels: Record<string, { tier: Tier; blockers: string[] }>;
};

const tiersAt = (aggressiveness: number) =>
  Object.fromEntries(rankJobs(pool, aggressiveness).map((r) => [r.job.id, r.tier]));

describe("policy", () => {
  it("matches every hand label in expected.json at default aggressiveness", () => {
    const ranked = rankJobs(pool);
    for (const r of ranked) {
      const label = expected.labels[r.job.id]!;
      expect({ id: r.job.id, tier: r.tier }).toEqual({ id: r.job.id, tier: label.tier });
      expect(r.blockers.map((b) => b.kind).sort()).toEqual([...label.blockers].sort());
    }
  });

  it("ranks best tier first with 1-based ranks", () => {
    const ranked = rankJobs(pool);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(ranked.map((r) => r.tier)).toEqual(["apply", "maybe", "stretch", "big_stretch", "no"]);
  });

  it("never gives a worse tier when aggressiveness goes up", () => {
    const steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    for (const job of jobs) {
      const tiers = steps.map((a) => TIER_ORDER.indexOf(tiersAt(a)[job.id]!));
      for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBeLessThanOrEqual(tiers[i - 1]!);
    }
  });

  it("actually moves jobs at the extremes", () => {
    expect(tiersAt(1)["prairie-health-tech:fixture:2002"]).toBe("apply");
    expect(tiersAt(0)["prairie-health-tech:fixture:2002"]).toBe("stretch");
  });

  it("keeps blocked jobs at 'no' even at full aggressiveness", () => {
    expect(tiersAt(1)["loop-defense-systems:fixture:5005"]).toBe("no");
  });

  it("explains itself: blockers come first in the reasons", () => {
    const loop = rankJobs(pool).find((r) => r.job.company === "Loop Defense Systems")!;
    expect(loop.reasons[0]).toMatch(/^Blocker:/);
  });
});
