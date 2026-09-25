import { describe, expect, it } from "vitest";
import { extractRequirements } from "../src/extract/requirements";
import { parseResume } from "../src/extract/resume";
import { jobAt, label, lakeshoreRequirements, resumeText } from "./helpers";

describe("extractRequirements", () => {
  it("reproduces the hand-encoded Lakeshore requirements exactly", () => {
    expect(extractRequirements(jobAt("Lakeshore Logistics"))).toEqual(lakeshoreRequirements);
  });

  it("keeps 'A or B' as one requirement but splits 'A and B' into two", () => {
    const labels = extractRequirements(jobAt("Prairie Health Tech")).map(label);
    expect(labels).toContain("typescript");
    expect(labels).toContain("react");
  });

  it("pulls both the years bar and the skills out of one line", () => {
    const fromGoLine = extractRequirements(jobAt("Northbrook Robotics")).filter((r) => r.text.startsWith("2+ years"));
    expect(fromGoLine.map(label)).toEqual(["experience", "go|rust"]);
  });

  it("marks 'or equivalent practical experience' on the degree", () => {
    const degree = extractRequirements(jobAt("Prairie Health Tech")).find((r) => r.kind === "education");
    expect(degree).toMatchObject({ minDegree: "bachelor", orEquivalentExperience: true });
  });

  it("takes the lowest degree from 'MS or PhD'", () => {
    const degree = extractRequirements(jobAt("Riverline Capital")).find((r) => r.kind === "education");
    expect(degree).toMatchObject({ minDegree: "master", importance: "required" });
  });

  it("ignores responsibilities bullets", () => {
    const texts = extractRequirements(jobAt("Lakeshore Logistics")).map((r) => r.text);
    expect(texts).not.toContain("Write tests and participate in code review");
  });
});

describe("parseResume", () => {
  const resume = parseResume(resumeText, { asOf: new Date("2026-09-25") });

  it("finds the degree, skills and technical experience", () => {
    expect(resume.degree).toBe("bachelor");
    expect(resume.skills).toEqual(expect.arrayContaining(["java", "python", "c++", "sql", "postgresql", "docker"]));
    expect(resume.skills).not.toContain("typescript");
    expect(resume.skills).not.toContain("go");
  });

  it("counts the 3-month internship but not the TA job", () => {
    expect(resume.yearsExperience).toBe(0.25);
  });

  it("treats unstated eligibility as unknown, not false", () => {
    expect(resume.eligibility).toEqual({});
  });
});
