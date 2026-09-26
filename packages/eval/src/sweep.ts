// Grid-searches the shared policy on the DEV split only. Held-out cases are never loaded into the search.
// Facts are computed once per assessor (Jev from cache), then thousands of policies are tried in milliseconds:
// the facts/policy split is what makes this cheap.
// Run: npm run sweep
import {
  classify, parseResume, POLICY, rulesAssessor, type AssessedJob, type Assessor, type Policy, type Tier,
} from "@jevjob/core";
import { createJevAssessor, fileCache } from "@jevjob/jev";
import { loadDataset } from "./dataset";

const ROOT = new URL("../../../", import.meta.url);
const GOOD = new Set<Tier>(["apply", "maybe"]);
const SKIP = new Set<Tier>(["big_stretch", "no"]);

try {
  process.loadEnvFile(new URL(".env", ROOT));
} catch {
  // Jev answers should all be cached from `npm run eval -- jev --dev`.
}

const data = loadDataset();
const dev = data.cases.filter((c) => c.split === "dev");
const resumes = new Map([...data.resumes].map(([k, t]) => [k, parseResume(t, { asOf: data.asOf })]));
const assessors: Assessor[] = [rulesAssessor, createJevAssessor({ cache: fileCache(new URL(".jevjob/cache/jev/", ROOT)) })];

const facts = new Map<string, AssessedJob[]>();
let uncached = 0;
for (const assessor of assessors) {
  const list: AssessedJob[] = [];
  for (const c of dev) {
    const result = await assessor.assess(resumes.get(c.resume)!, data.jobs.get(c.job)!);
    if (assessor.name === "jev" && !result.cached) uncached++;
    list.push(result.assessed);
  }
  facts.set(assessor.name, list);
}
if (uncached) console.log(`note: ${uncached} Jev answers weren't cached and were fetched just now`);

interface Score { exact: number; falseSkip: number; falseApply: number }
function evaluate(policy: Policy, name: string): Score {
  const s: Score = { exact: 0, falseSkip: 0, falseApply: 0 };
  facts.get(name)!.forEach((assessed, i) => {
    const expected = dev[i]!.tier;
    const got = classify(assessed, 0.5, policy).ranked.tier;
    if (got === expected) s.exact++;
    if (GOOD.has(expected) && SKIP.has(got)) s.falseSkip++;
    if (!GOOD.has(expected) && got === "apply") s.falseApply++;
  });
  return s;
}

const distance = (p: Policy) =>
  Math.abs(p.thresholds.apply - POLICY.thresholds.apply) + Math.abs(p.thresholds.maybe - POLICY.thresholds.maybe) +
  Math.abs(p.thresholds.stretch - POLICY.thresholds.stretch) + Math.abs(p.hardGapPenalty - POLICY.hardGapPenalty) +
  Math.abs(p.preferredWeight - POLICY.preferredWeight);

const candidates: Array<{ policy: Policy; rules: Score; jev: Score }> = [];
for (const apply of [0.8, 0.85, 0.9, 0.95])
  for (const maybe of [0.55, 0.6, 0.65, 0.7, 0.75])
    for (const stretch of [-0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
      for (const hardGapPenalty of [0, 0.1, 0.15, 0.2, 0.3])
        for (const preferredWeight of [0, 0.1, 0.2]) {
          if (!(apply > maybe && maybe > stretch)) continue;
          const policy: Policy = { ...POLICY, hardGapPenalty, preferredWeight, thresholds: { apply, maybe, stretch } };
          candidates.push({ policy, rules: evaluate(policy, "rules"), jev: evaluate(policy, "jev") });
        }

const safe = candidates.filter((c) => [c.rules, c.jev].every((s) => s.falseSkip === 0 && s.falseApply === 0));
safe.sort((a, b) => b.rules.exact + b.jev.exact - (a.rules.exact + a.jev.exact) || distance(a.policy) - distance(b.policy));

const fmt = (c: (typeof candidates)[number]) => {
  const t = c.policy.thresholds;
  return `apply ${t.apply} maybe ${t.maybe} stretch ${t.stretch} gap ${c.policy.hardGapPenalty} pref ${c.policy.preferredWeight}` +
    `  →  rules ${c.rules.exact}/${dev.length}, jev ${c.jev.exact}/${dev.length}`;
};
const current = { policy: POLICY, rules: evaluate(POLICY, "rules"), jev: evaluate(POLICY, "jev") };
console.log(`${candidates.length} policies tried, ${safe.length} with zero false-skips and zero false-applies\n`);
console.log(`current  ${fmt(current)}`);
const best = safe[0]!.rules.exact + safe[0]!.jev.exact;
console.log(`${safe.filter((c) => c.rules.exact + c.jev.exact === best).length} settings tie for best; closest to current first:`);
for (const c of safe.slice(0, 5)) console.log(`         ${fmt(c)}`);
