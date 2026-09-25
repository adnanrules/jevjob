import { describe, expect, it } from "vitest";
import { assessJob } from "../src/assess/rules";
import type { Verdict } from "../src/domain";
import { parseResume } from "../src/extract/resume";
import { jobAt, label, resumeText } from "./helpers";

const resume = parseResume(resumeText, { asOf: new Date("2026-09-25") });

/** { requirementLabel: verdict } for one fixture company. */
function verdicts(company: string): Record<string, Verdict> {
  const { requirements, assessments } = assessJob(resume, jobAt(company));
  const byId = new Map(assessments.map((a) => [a.requirementId, a.verdict]));
  return Object.fromEntries(requirements.map((r) => [label(r), byId.get(r.id)!]));
}

describe("rule assessor", () => {
  it("Lakeshore: every required item is green, only AWS is red", () => {
    expect(verdicts("Lakeshore Logistics")).toEqual({
      education: "meets", "java|python": "meets", sql: "meets", git: "meets", experience: "meets",
      "spring boot": "meets", aws: "does_not_meet", docker: "meets",
    });
  });

  it("Prairie: JavaScript is only partial evidence for TypeScript; 0.25 of 1 year is borderline", () => {
    expect(verdicts("Prairie Health Tech")).toMatchObject({
      typescript: "unclear", react: "meets", "rest apis": "meets", experience: "unclear", education: "meets",
    });
  });

  it("Northbrook: Docker does NOT count as Kubernetes", () => {
    expect(verdicts("Northbrook Robotics")).toMatchObject({ kubernetes: "does_not_meet", "go|rust": "does_not_meet" });
  });

  it("Loop: missing clearance is red, unstated citizenship is only yellow", () => {
    expect(verdicts("Loop Defense Systems")).toMatchObject({
      security_clearance: "does_not_meet", us_citizenship: "unclear", experience: "does_not_meet", "c++": "meets",
    });
  });

  it("rules never invent a confidence number", () => {
    const { assessments } = assessJob(resume, jobAt("Riverline Capital"));
    expect(assessments.every((a) => a.source === "rules" && a.confidence === null)).toBe(true);
  });
});
