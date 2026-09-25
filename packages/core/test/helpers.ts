import { readFileSync } from "node:fs";
import type { RawJob, Requirement } from "../src/domain";

export const fixture = (name: string) =>
  readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8");

export const jobs = JSON.parse(fixture("jobs.json")) as RawJob[];
export const jobAt = (company: string) => jobs.find((j) => j.company === company)!;
export const resumeText = fixture("resume.jordan-rivera.md");

/** A readable key for a requirement in assertions: skills by name, eligibility by kind, others by category. */
export const label = (r: Requirement) =>
  r.kind === "skill" ? r.anyOf.join("|") : r.kind === "eligibility" ? r.eligibility : r.kind;

// Posting 1 (Lakeshore Logistics) hand-encoded: the answer key for requirement extraction.
const lakeshoreId = "lakeshore-logistics:fixture:1001";
export const lakeshoreRequirements: Requirement[] = [
  { id: `${lakeshoreId}#r1`, kind: "education", importance: "required", minDegree: "bachelor", orEquivalentExperience: false,
    text: "Bachelor's degree in Computer Science or a related field" },
  { id: `${lakeshoreId}#r2`, kind: "skill", importance: "required", anyOf: ["java", "python"],
    text: "Proficiency in Java or Python" },
  { id: `${lakeshoreId}#r3`, kind: "skill", importance: "required", anyOf: ["sql"], text: "Working knowledge of SQL" },
  { id: `${lakeshoreId}#r4`, kind: "skill", importance: "required", anyOf: ["git"], text: "Experience with Git" },
  { id: `${lakeshoreId}#r5`, kind: "experience", importance: "required", minYears: 0,
    text: "0-2 years of experience; new graduates welcome" },
  { id: `${lakeshoreId}#r6`, kind: "skill", importance: "preferred", anyOf: ["spring boot"], text: "Spring Boot" },
  { id: `${lakeshoreId}#r7`, kind: "skill", importance: "preferred", anyOf: ["aws"], text: "AWS" },
  { id: `${lakeshoreId}#r8`, kind: "skill", importance: "preferred", anyOf: ["docker"], text: "Docker" },
];
