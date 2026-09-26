// Side-by-side rules vs Jev verdicts for one eval case. Uses the Jev response cache, so re-running is free.
// Run: npm run compare -- elena lakeshore
import { classify, parseResume, rulesAssessor, type AssessedJob, type Verdict } from "@jevjob/core";
import { createJevAssessor, fileCache } from "@jevjob/jev";
import { loadDataset } from "../packages/eval/src/dataset";

const ROOT = new URL("../", import.meta.url);
const [who, jobQuery] = process.argv.slice(2);
if (!who || !jobQuery) throw new Error("Usage: npm run compare -- <resume> <company or job id substring>");

try {
  process.loadEnvFile(new URL(".env", ROOT));
} catch {
  // The SDK will read the real environment instead.
}

const data = loadDataset();
const text = data.resumes.get(who);
const job = [...data.jobs.values()].find((j) => `${j.id} ${j.company}`.toLowerCase().includes(jobQuery.toLowerCase()));
if (!text || !job) throw new Error(`No resume "${who}" or job matching "${jobQuery}"`);

const resume = parseResume(text, { asOf: data.asOf });
const jev = createJevAssessor({ cache: fileCache(new URL(".jevjob/cache/jev/", ROOT)) });
const [rules, model] = await Promise.all([rulesAssessor.assess(resume, job), jev.assess(resume, job)]);
const label = data.cases.find((c) => c.resume === who && c.job === job.id);

const MARK: Record<Verdict, string> = { meets: "✓", unclear: "?", does_not_meet: "✗" };
const verdicts = (a: AssessedJob) => new Map(a.assessments.map((x) => [x.requirementId, x]));
const r = verdicts(rules.assessed);
const j = verdicts(model.assessed);

console.log(`${who} → ${job.title} · ${job.company}${model.cached ? "  (Jev from cache)" : ""}`);
console.log(`tier: rules ${classify(rules.assessed, 0.5).ranked.tier}, jev ${classify(model.assessed, 0.5).ranked.tier}, label ${label?.tier ?? "?"}\n`);
console.log("rules jev   conf  requirement");
for (const req of rules.assessed.requirements) {
  const a = r.get(req.id)!;
  const b = j.get(req.id)!;
  const conf = b.confidence === null ? "  -  " : b.confidence.toFixed(2).padStart(5);
  const changed = a.verdict !== b.verdict ? " ←" : "";
  console.log(`  ${MARK[a.verdict]}    ${MARK[b.verdict]}  ${conf}  ${req.text}${req.kind === "skill" ? ` [${req.anyOf.join("|")}]` : ""}${changed}`);
}
