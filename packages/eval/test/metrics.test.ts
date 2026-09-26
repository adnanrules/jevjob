import { describe, expect, it } from "vitest";
import type { Tier } from "@jevjob/core";
import { computeMetrics, formatRate, type CaseResult } from "../src/metrics";

const result = (expected: Tier, predicted: Tier, extra: Partial<CaseResult> = {}): CaseResult => ({
  id: `${expected}->${predicted}`,
  split: "test",
  expected: { tier: expected, blockers: [] },
  predicted: { tier: predicted, blockers: [] },
  checks: [],
  latencyMs: 1,
  calls: 0,
  inputTokens: 0,
  cached: false,
  ...extra,
});

describe("computeMetrics", () => {
  it("counts exact and within-one-tier accuracy", () => {
    const m = computeMetrics([result("apply", "apply"), result("apply", "maybe"), result("apply", "stretch")]);
    expect(m.tierAccuracy).toEqual({ hits: 1, of: 3 });
    expect(m.withinOneTier).toEqual({ hits: 2, of: 3 });
  });

  it("false-skip only looks at jobs worth applying to", () => {
    const m = computeMetrics([result("maybe", "no"), result("apply", "apply"), result("stretch", "no")]);
    expect(m.falseSkip).toEqual({ hits: 1, of: 2 });
  });

  it("false-apply only looks at stretch-or-worse jobs", () => {
    const m = computeMetrics([result("stretch", "apply"), result("no", "no"), result("maybe", "apply")]);
    expect(m.falseApply).toEqual({ hits: 1, of: 2 });
  });

  it("scores blockers as sets: recall over expected, precision over predicted", () => {
    const m = computeMetrics([
      result("no", "no", {
        expected: { tier: "no", blockers: ["security_clearance", "experience_years"] },
        predicted: { tier: "no", blockers: ["security_clearance", "us_citizenship"] },
      }),
    ]);
    expect(m.blockerRecall).toEqual({ hits: 1, of: 2 });
    expect(m.blockerPrecision).toEqual({ hits: 1, of: 2 });
  });

  it("counts unextracted requirement lines as wrong and reports them separately", () => {
    const m = computeMetrics([
      result("apply", "apply", {
        checks: [
          { requirement: "a", expected: "meets", predicted: "meets" },
          { requirement: "b", expected: "meets", predicted: null },
        ],
      }),
    ]);
    expect(m.requirementChecks).toEqual({ hits: 1, of: 2 });
    expect(m.notExtracted).toBe(1);
  });

  it("builds a confusion matrix indexed [expected][predicted]", () => {
    const m = computeMetrics([result("apply", "maybe"), result("apply", "maybe")]);
    expect(m.confusion.apply.maybe).toBe(2);
    expect(m.confusion.maybe.apply).toBe(0);
  });

  it("never divides by zero", () => {
    const m = computeMetrics([]);
    expect(formatRate(m.tierAccuracy)).toBe("n/a");
    expect(m.meanLatencyMs).toBeNull();
  });

  it("leaves cached cases out of latency but keeps them in cost", () => {
    const m = computeMetrics([
      result("apply", "apply", { latencyMs: 400, calls: 1, inputTokens: 900 }),
      result("apply", "apply", { latencyMs: 1, calls: 1, inputTokens: 900, cached: true }),
    ]);
    expect(m.meanLatencyMs).toBe(400);
    expect(m.callsPerJob).toBe(1);
    expect(m.inputTokensPerJob).toBe(900);
  });
});
