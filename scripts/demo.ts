// Prints every fixture job's requirements colored by the rule assessor's verdict.
// Run: npm run demo
import { readFileSync } from "node:fs";
import { styleText } from "node:util";
import { assessJob, parseResume, type RawJob, type Verdict } from "@jevjob/core";

const fixtures = new URL("../fixtures/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, fixtures), "utf8");

const resume = parseResume(read("resume.jordan-rivera.md"));
const jobs = JSON.parse(read("jobs.json")) as RawJob[];

const STYLE: Record<Verdict, { color: "green" | "yellow" | "red"; mark: string }> = {
  meets: { color: "green", mark: "✓" },
  unclear: { color: "yellow", mark: "?" },
  does_not_meet: { color: "red", mark: "✗" },
};

console.log(styleText("dim", `Resume: ${resume.degree}, ${resume.yearsExperience} yrs, ${resume.skills.length} skills`));

for (const job of jobs) {
  const { requirements, assessments } = assessJob(resume, job);
  const byId = new Map(assessments.map((a) => [a.requirementId, a]));
  console.log("\n" + styleText("bold", `${job.title} · ${job.company}`));
  for (const req of requirements) {
    const a = byId.get(req.id)!;
    const { color, mark } = STYLE[a.verdict];
    const tag = styleText("dim", ` [${req.importance} ${req.kind}]${a.evidence ? `  ← ${a.evidence}` : ""}`);
    console.log(`  ${styleText(color, `${mark} ${req.text}`)}${tag}`);
  }
}
