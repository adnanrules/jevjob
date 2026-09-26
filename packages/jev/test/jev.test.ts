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

/** Runs interpret with answers keyed by requirement text instead of question keys. Easier to read in tests. */
function verdictsWith(company: string, answerFor: (key: string, text: string) => unknown): Record<string, Verdict> {
  const base = assessJob(resume, jobAt(company));
  const { questions, plan } = buildRequest(resume, jobAt(company), base.requirements);
  const textOf = new Map<string, string>();
  for (const [id, key] of [...plan.verdict, ...plan.experienceKind]) textOf.set(key, base.requirements.find((r) => r.id === id)!.text);
  for (const [text, key] of plan.lineRequires) textOf.set(key, text);
  const answers = Object.fromEntries(Object.keys(questions).map((key) => [key, answerFor(key, textOf.get(key)!)]));
  const result = interpret(base, plan, answers);
  return Object.fromEntries(result.requirements.map((r, i) => [`${r.text}#${i}`, result.assessments[i]!.verdict]));
}
const find = (verdicts: Record<string, Verdict>, text: string) =>
  Object.entries(verdicts).filter(([k]) => k.includes(text)).map(([, v]) => v);

describe("buildRequest", () => {
  const job = jobAt("Northbrook Robotics");
  const base = assessJob(resume, job);
  const { state, questions, plan } = buildRequest(resume, job, base.requirements);

  it("sends the resume once as state and asks one question per requirement", () => {
    expect(state).toEqual({ resume: resume.rawText });
    expect(plan.verdict.size + plan.experienceKind.size).toBe(base.requirements.length);
  });

  it("asks about the KIND of experience with a Noul and leaves the years to code", () => {
    const expId = base.requirements.find((r) => r.kind === "experience")!.id;
    expect(questions[plan.experienceKind.get(expId)!]!.type).toBe("noul");
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
      key.startsWith("line_") ? noul(text.includes("not required") ? 0.05 : 0.95) : key.startsWith("kind_") ? noul(0.9) : choice("meets"));
    expect(find(v, "degree is not required")).toEqual(["meets"]);
  });

  it("turns low-confidence answers into unclear instead of trusting them", () => {
    const v = verdictsWith("Lakeshore Logistics", (key) => (key.startsWith("req_") ? choice("does_not_meet", 0.3) : noul(0.95)));
    expect(find(v, "AWS")).toEqual(["unclear"]);
  });

  it("requires both: code's years AND Jev's kind of experience", () => {
    // Right kind of work, but code already knows 0.25 years is far short of 2+.
    const v = verdictsWith("Northbrook Robotics", (key) => (key.startsWith("kind_") ? noul(0.95) : key.startsWith("line_") ? noul(0.95) : choice("meets")));
    expect(find(v, "2+ years")).toContain("does_not_meet");
  });

  it("keeps 'clearance not stated' as does_not_meet, but 'citizenship not stated' as unclear", () => {
    const v = verdictsWith("Loop Defense Systems", (key) => (key.startsWith("req_") ? choice("not_stated") : noul(0.95)));
    expect(find(v, "clearance")).toEqual(["does_not_meet"]);
    expect(find(v, "citizenship")).toEqual(["unclear"]);
  });

  it("falls back to the rules verdict when an answer is missing or malformed", () => {
    const base = assessJob(resume, jobAt("Lakeshore Logistics"));
    const { plan } = buildRequest(resume, jobAt("Lakeshore Logistics"), base.requirements);
    const result = interpret(base, plan, { req_0: { type: "choice", choice: "meets" } }); // missing confidence
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
        const answers = Object.fromEntries(Object.entries(req.questions).map(([k, q]) => [k, q.type === "noul" ? noul(0.9) : choice("meets")]));
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
