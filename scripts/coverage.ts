// How many postings in the current pool does each assessor actually understand?
// "Unreadable" = no required qualifications found, so the posting can only be a guess.
// Run: npm run coverage -- [resume.md]
import { readFileSync } from "node:fs";
import { parseResume, rulesAssessor } from "@jevjob/core";
import { currentJobs, getAssessor } from "@jevjob/harness";

const resume = parseResume(readFileSync(process.argv[2] ?? "fixtures/resume.jordan-rivera.md", "utf8"));
const { source, jobs } = currentJobs();
const jev = getAssessor("jev");

let rulesUnreadable = 0;
let jevUnreadable = 0;
let calls = 0;
let twoStage = 0;
for (let i = 0; i < jobs.length; i += 4) {
  const batch = jobs.slice(i, i + 4);
  const results = await Promise.all(batch.map(async (job) => [await rulesAssessor.assess(resume, job), await jev.assess(resume, job)] as const));
  for (const [rules, model] of results) {
    const required = (r: typeof rules) => r.assessed.requirements.filter((q) => q.importance === "required").length;
    if (required(rules) === 0) rulesUnreadable++;
    if (required(model) === 0) jevUnreadable++;
    calls += model.calls;
    if (model.calls === 2) twoStage++;
  }
}
console.log(`${jobs.length} postings (${source})`);
console.log(`no requirements found: rules ${rulesUnreadable}, jev ${jevUnreadable}`);
console.log(`jev calls: ${calls} (${twoStage} postings needed the extraction stage)`);
