import { describe, expect, it } from "vitest";
import { extractRequirements } from "../src/extract/requirements";
import { findEligibility } from "../src/extract/patterns";
import { parseResume, yearsOf } from "../src/extract/resume";
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

  it("finds requirement headers phrased the way real postings phrase them", () => {
    const job = {
      ...jobAt("Lakeshore Logistics"),
      description: [
        "What You'll Do", "• Build things",
        "Your Skills & Abilities (Required Qualifications)", "• Minimum 10 years of professional software development experience", "• Excellent knowledge of C++ and Java",
        "What Will Give You A Competitive Edge (Preferred Qualifications)", "• Kubernetes",
        "This role requires relocation and the candidate must be available in person.", "• Not a requirement bullet",
      ].join("\n"),
    };
    const reqs = extractRequirements(job);
    expect(reqs.map((r) => [r.importance, r.kind])).toEqual([
      ["required", "experience"], ["required", "skill"], ["required", "skill"], ["preferred", "skill"],
    ]);
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

  it("parses every dated role with its bullets, and counts overlapping months once", () => {
    expect(resume.roles.map((r) => r.title)).toEqual(["Software Engineering Intern", "Teaching Assistant"]);
    expect(resume.roles[0]!.text).toContain("Spring Boot");
    // Jan 2025 – May 2026 contains Jun – Aug 2025: 17 months total, not 20.
    expect(yearsOf(resume.roles)).toBe(1.42);
  });
});

describe("parseResume on text extracted from a PDF or Word file", () => {
  // No markdown: plain-text headers, other bullet characters, numeric dates, titles above their dates.
  const pdfText = [
    "ALEX KIM",
    "alex@example.com | Chicago, IL",
    "EDUCATION",
    "Bachelor of Science in Computer Science, Lakeview State University",
    "PROFESSIONAL EXPERIENCE",
    "Software Engineer Intern",
    "Acme Corp | 06/2024 – 08/2024",
    "● Built data pipelines in Python and SQL",
    "Barista, Bean There Cafe   Sep 2021 – May 2024",
    "▪ Trained new hires",
    "TECHNICAL SKILLS:",
    "Python, SQL, Docker",
  ].join("\n");
  const resume = parseResume(pdfText, { asOf: new Date("2026-09-25") });

  it("finds plain-text section headers and the degree", () => {
    expect(resume.degree).toBe("bachelor");
    expect(resume.roles).toHaveLength(2);
  });

  it("takes the title from the line above when the date line has none of its own", () => {
    expect(resume.roles[0]!.title).toBe("Software Engineer Intern");
    expect(resume.roles[0]!.text).toContain("Built data pipelines");
    expect(resume.roles[1]!.title).toBe("Barista");
  });

  it("pairs dates from a separate text box with the role headings that follow, in order", () => {
    const wordTemplate = [
      "Experience",
      "Aug 2020-Feb 2025",
      "Feb 2025 – June 2026",
      "Freelance Developer, Remote",
      "- Built client apps",
      "IT Tech Support, East Gate Training",
      "- Fixed network issues",
      "Certifications",
    ].join("\n");
    const r = parseResume(wordTemplate, { asOf: new Date("2026-09-25") });
    expect(r.roles.map((x) => x.title)).toEqual(["Freelance Developer", "IT Tech Support"]);
    expect(r.roles[1]!.text).toContain("Fixed network issues");
    expect(r.roles[0]!.endMonth - r.roles[0]!.startMonth + 1).toBe(55);
  });

  it("reads numeric dates and still counts only technical titles for the rules", () => {
    expect(resume.yearsExperience).toBe(0.25);
    expect(resume.skills).toEqual(expect.arrayContaining(["python", "sql", "docker"]));
  });
});

describe("findEligibility", () => {
  it("doesn't mistake a driver's license for a professional license", () => {
    expect(findEligibility("Valid driver's license and ability to travel")).toBeNull();
    expect(findEligibility("Active nursing license in Illinois")).toBe("professional_license");
  });
});
