import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessJob, parseResume, type RawJob, type Verdict } from "@jevjob/core";
import { createJevAssessor, type JevClient } from "../src/assessor";
import type { Cache } from "../src/cache";
import { interpret } from "../src/interpret";
import { buildRequest } from "../src/questions";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const resume = parseResume(read("fixtures/resume.jordan-rivera.md"), { asOf: new Date("2026-09-25") });
const jobs = [
  ...(JSON.parse(read("fixtures/jobs.json")) as RawJob[]),
  ...(JSON.parse(read("packages/eval/dataset/jobs.json")) as RawJob[]),
];
const jobAt = (company: string) => jobs.find((j) => j.company === company)!;

const choice = (label: string, confidence = 0.9) => ({ type: "choice", choice: label, confidence, probabilities: { [label]: confidence } });
const noul = (p: number) => ({ type: "noul", noul: p });

/** Runs interpret with answers chosen per question (by key and the posting line it's about). */
function verdictsWith(company: string, answerFor: (key: string, text: string) => unknown): Record<string, Verdict> {
  const base = assessJob(resume, jobAt(company));
  const { questions, plan } = buildRequest(resume, jobAt(company), base.requirements);
  const textOf = new Map<string, string>();
  const reqText = (id: string) => base.requirements.find((r) => r.id === id)!.text;
  for (const [id, key] of plan.verdict) textOf.set(key, reqText(id));
  for (const [id, keys] of plan.experienceRoles) for (const key of keys) textOf.set(key, reqText(id));
  for (const [text, key] of plan.lineRequires) textOf.set(key, text);
  const answers = Object.fromEntries(Object.keys(questions).map((key) => [key, answerFor(key, textOf.get(key)!)]));
  const result = interpret(base, plan, answers, resume);
  return Object.fromEntries(result.requirements.map((r, i) => [`${r.text}#${i}`, result.assessments[i]!.verdict]));
}
const find = (verdicts: Record<string, Verdict>, text: string) =>
  Object.entries(verdicts).filter(([k]) => k.includes(text)).map(([, v]) => v);

describe("buildRequest", () => {
  const job = jobAt("Northbrook Robotics");
  const base = assessJob(resume, job);
  const { state, questions, plan } = buildRequest(resume, job, base.requirements);

  it("sends the resume once as state and covers every requirement", () => {
    expect(state.resume).toBe(resume.rawText);
    // Code-computed facts ride along, so Jev never has to do date arithmetic.
    expect(state.facts).toMatchObject({ highest_degree: "bachelor", years_across_all_jobs: 1.42 });
    expect(state.facts.jobs[0]).toBe("Software Engineering Intern: 3 months");
    expect(plan.verdict.size + plan.experienceRoles.size).toBe(base.requirements.length);
  });

  it("asks one yes/no per resume role for an experience line, and leaves the years to code", () => {
    const expId = base.requirements.find((r) => r.kind === "experience")!.id;
    const keys = plan.experienceRoles.get(expId)!;
    expect(keys).toHaveLength(resume.roles.length);
    for (const key of keys) expect(questions[key]!.type).toBe("noul");
  });

  it("asks the 'does this line require anything?' question once per required line, never for preferred ones", () => {
    const requiredLines = new Set(base.requirements.filter((r) => r.importance === "required").map((r) => r.text));
    expect(plan.lineRequires.size).toBe(requiredLines.size);
    expect(plan.lineRequires.has("gRPC")).toBe(false);
  });
});

describe("interpret", () => {
  it("fixes the negation trap: 'A degree is not required' becomes met", () => {
    const v = verdictsWith("Harbor Point Health", (key, text) =>
      key.startsWith("line_") ? noul(text.includes("not required") ? 0.05 : 0.95) : key.startsWith("role_") ? noul(0.9) : choice("meets"));
    expect(find(v, "degree is not required")).toEqual(["meets"]);
  });

  it("turns low-confidence answers into unclear instead of trusting them", () => {
    const v = verdictsWith("Lakeshore Logistics", (key) => (key.startsWith("req_") ? choice("does_not_meet", 0.2) : noul(0.95)));
    expect(find(v, "AWS")).toEqual(["unclear"]);
  });

  it("adds up only the months of roles Jev says are the right kind", () => {
    // Jordan: a 3-month internship inside a 17-month TA job. "2+ years of backend development":
    const internshipOnly = verdictsWith("Northbrook Robotics", (key) =>
      key.startsWith("role_") ? noul(key.endsWith("_0") ? 0.95 : 0.05) : key.startsWith("line_") ? noul(0.95) : choice("meets"));
    expect(find(internshipOnly, "2+ years")).toContain("does_not_meet"); // 0.25 years
    const bothRoles = verdictsWith("Northbrook Robotics", (key) =>
      key.startsWith("role_") ? noul(0.95) : key.startsWith("line_") ? noul(0.95) : choice("meets"));
    expect(find(bothRoles, "2+ years")).toContain("unclear"); // 17 months, overlap counted once: within a year of 2
  });

  it("keeps 'clearance not stated' as does_not_meet, but 'citizenship not stated' as unclear", () => {
    const v = verdictsWith("Loop Defense Systems", (key) => (key.startsWith("req_") ? choice("not_stated") : noul(0.95)));
    expect(find(v, "clearance")).toEqual(["does_not_meet"]);
    expect(find(v, "citizenship")).toEqual(["unclear"]);
  });

  it("falls back to the rules verdict when an answer is missing or malformed", () => {
    const base = assessJob(resume, jobAt("Lakeshore Logistics"));
    const { plan } = buildRequest(resume, jobAt("Lakeshore Logistics"), base.requirements);
    const result = interpret(base, plan, { req_0: { type: "choice", choice: "meets" } }, resume); // missing confidence
    expect(result.assessments).toEqual(base.assessments);
  });
});

describe("createJevAssessor", () => {
  const fakeClient = (): JevClient & { calls: number } => {
    const client = {
      calls: 0,
      defaultModel: "jev-test",
      systemOne: (async (req: { questions: Record<string, { type: string }> }) => {
        client.calls++;
        // Stage-1 line questions: every line containing "Python" or "degree" is a requirement, the rest are duties.
        const answers = Object.fromEntries(
          Object.entries(req.questions).map(([k, q]) => {
            if (k.startsWith("role_of_line_")) {
              const line = String((q as { instructions?: { line?: string } }).instructions?.line ?? "");
              return [k, choice(/python|degree/i.test(line) ? "required" : "duty")];
            }
            return [k, q.type === "noul" ? noul(0.9) : choice("meets")];
          }),
        );
        return { model: "jev-test", answers, usage: { input_tokens: 1234, output_tokens: 0 } };
      }) as unknown as JevClient["systemOne"],
    };
    return client;
  };

  it("makes exactly one call per job and reports its token usage", async () => {
    const client = fakeClient();
    const result = await createJevAssessor({ client }).assess(resume, jobAt("Riverline Capital"));
    expect(client.calls).toBe(1);
    expect(result).toMatchObject({ calls: 1, inputTokens: 1234, cached: false });
    expect(result.assessed.assessments.every((a) => a.source === "jev")).toBe(true);
  });

  it("asks Jev to find the requirements when a posting has no recognizable requirements section", async () => {
    const client = fakeClient();
    const headerless: RawJob = {
      ...jobAt("Riverline Capital"),
      id: "headerless:1",
      description: [
        "About the team", "We build models for the trading desk.",
        "The work", "• Ship models to production", "• Partner with traders",
        "Who thrives here", "• Strong Python", "• A degree in a quantitative field", "• Enjoys ambiguity",
      ].join("\n"),
    };
    const result = await createJevAssessor({ client }).assess(resume, headerless);
    expect(client.calls).toBe(2);
    expect(result.calls).toBe(2);
    expect(result.assessed.requirements.map((r) => r.text)).toEqual(["Strong Python", "A degree in a quantitative field"]);
  });

  it("serves an identical second request from the cache", async () => {
    const client = fakeClient();
    const store = new Map<string, unknown>();
    const cache: Cache = {
      get: async (req) => store.get(JSON.stringify(req)),
      set: async (req, res) => void store.set(JSON.stringify(req), res),
    };
    const jev = createJevAssessor({ client, cache });
    await jev.assess(resume, jobAt("Riverline Capital"));
    const second = await jev.assess(resume, jobAt("Riverline Capital"));
    expect(client.calls).toBe(1);
    expect(second.cached).toBe(true);
  });
});