// Terminal preview of the ranked board: rank number colored by tier, requirement lines colored by verdict.
// Run: npm run demo            (aggressiveness 0.5)
//      npm run demo -- 0.9     (closer to "apply anyway")
import { readFileSync } from "node:fs";
import { assessJob, parseResume, rankJobs, type RawJob, type Tier, type Verdict } from "@jevjob/core";

const fixtures = new URL("../fixtures/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, fixtures), "utf8");

// 256-color ANSI codes: the basic 8 colors have no orange or dark red.
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const paint = (code: number, text: string) => (useColor ? `\x1b[38;5;${code}m${text}\x1b[0m` : text);
const dim = (text: string) => (useColor ? `\x1b[2m${text}\x1b[0m` : text);

const TIER: Record<Tier, { code: number; label: string }> = {
  apply: { code: 42, label: "Apply" },
  maybe: { code: 220, label: "Maybe" },
  stretch: { code: 208, label: "Stretch" },
  big_stretch: { code: 196, label: "Big stretch" },
  no: { code: 88, label: "No" },
};
const VERDICT: Record<Verdict, { code: number; mark: string }> = {
  meets: { code: 42, mark: "✓" },
  unclear: { code: 220, mark: "?" },
  does_not_meet: { code: 196, mark: "✗" },
};

const aggressiveness = Number(process.argv[2] ?? 0.5);
const resume = parseResume(read("resume.jordan-rivera.md"));
const jobs = JSON.parse(read("jobs.json")) as RawJob[];

// Facts once, policy once. In the UI, only rankJobs re-runs when the slider moves.
const ranked = rankJobs(jobs.map((job) => assessJob(resume, job)), aggressiveness);

console.log(dim(`Aggressiveness ${aggressiveness} · resume: ${resume.degree}, ${resume.yearsExperience} yrs, ${resume.skills.length} skills`));

for (const job of ranked) {
  const tier = TIER[job.tier];
  const { met, total } = job.coverage.required;
  console.log(
    `\n${paint(tier.code, `#${job.rank} ${tier.label.padEnd(11)}`)} ${job.job.title} · ${job.job.company}` +
      dim(`  ${met}/${total} required · ${job.job.applyUrl}`),
  );
  const byId = new Map(job.assessments.map((a) => [a.requirementId, a.verdict]));
  const shown = new Set<string>();
  for (const req of job.requirements) {
    if (shown.has(req.text)) continue; // One bullet can hold several requirements; show it once, worst verdict wins.
    shown.add(req.text);
    const verdicts = job.requirements.filter((r) => r.text === req.text).map((r) => byId.get(r.id)!);
    const worst = verdicts.includes("does_not_meet") ? "does_not_meet" : verdicts.includes("unclear") ? "unclear" : "meets";
    const v = VERDICT[worst];
    console.log(`   ${paint(v.code, `${v.mark} ${req.text}`)}${dim(req.importance === "preferred" ? "  (preferred)" : "")}`);
  }
}
