import { describe, expect, it } from "vitest";
import type { Requirement } from "../src/domain";

// Posting 1 (Lakeshore Logistics) hand-encoded. This is the answer key the rule-based
// extractor has to reproduce in the next step.
const jobId = "lakeshore-logistics:fixture:1001";

export const lakeshoreRequirements: Requirement[] = [
  { id: `${jobId}#r1`, kind: "education", importance: "required", minDegree: "bachelor", orEquivalentExperience: false,
    text: "Bachelor's degree in Computer Science or a related field" },
  { id: `${jobId}#r2`, kind: "skill", importance: "required", anyOf: ["java", "python"],
    text: "Proficiency in Java or Python" },
  { id: `${jobId}#r3`, kind: "skill", importance: "required", anyOf: ["sql"],
    text: "Working knowledge of SQL" },
  { id: `${jobId}#r4`, kind: "skill", importance: "required", anyOf: ["git"],
    text: "Experience with Git" },
  { id: `${jobId}#r5`, kind: "experience", importance: "required", minYears: 0,
    text: "0-2 years of experience; new graduates welcome" },
  { id: `${jobId}#r6`, kind: "skill", importance: "preferred", anyOf: ["spring boot"], text: "Spring Boot" },
  { id: `${jobId}#r7`, kind: "skill", importance: "preferred", anyOf: ["aws"], text: "AWS" },
  { id: `${jobId}#r8`, kind: "skill", importance: "preferred", anyOf: ["docker"], text: "Docker" },
];

describe("domain model", () => {
  it("encodes every Lakeshore requirement line", () => {
    expect(lakeshoreRequirements).toHaveLength(8);
    expect(lakeshoreRequirements.filter((r) => r.importance === "required")).toHaveLength(5);
  });

  it("represents 'Java or Python' as ONE requirement with two options", () => {
    const javaOrPython = lakeshoreRequirements.find((r) => r.id.endsWith("#r2"));
    expect(javaOrPython?.kind === "skill" && javaOrPython.anyOf).toEqual(["java", "python"]);
  });
});
