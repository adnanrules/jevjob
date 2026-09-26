# Eval log

A running lab notebook. Every number here was produced by `npm run eval` at the commit listed; the
full reports live in `packages/eval/results/`. Newest entry last.

## 1. Rules baseline (commit `370912e`)

40 hand-labeled cases: 5 used to hand-tune the policy (dev), 35 not (test).

| test (n=35) | rules |
|---|---|
| Tier exact | 17/35 (49%) |
| Requirement checks | 16/24 (67%) |
| False-skip / false-apply | 0/13 · 0/22 |

14 of 18 misses were one error: big_stretch predicted as stretch. The stretch threshold was tuned on 5 cases.
Requirement misses were language: "A degree is **not** required", "U.S. citizen" ⇒ authorized to work,
"designed a distributed rate limiter" ⇒ distributed systems, tools missing from the skill dictionary.

## 2. First Jev run, untuned (commit `ab4b262`)

| test (n=35) | rules | jev |
|---|---|---|
| Tier exact | 17/35 (49%) | 21/35 (60%) |
| Requirement checks | 16/24 (67%) | 21/24 (88%) |
| Latency / job | 0.07 ms | 223 ms |
| Calls / input tokens per job | 0 / 0 | 1 / ~2,300 |

New Jev errors were mostly my question wording: "is the experience the kind this line asks for?" on a
line that names no kind ("0-2 years of experience") got "no". TypeSafe's docs predict this: Jev answers
the question you wrote, not the one you meant.

## 3. Tuning on dev (commits `66752a9`, `bc0c060`)

Because entry 2's errors had been inspected, all 40 cases became the **dev** set. A new **held-out** set
(3 candidates × 6 postings) was written and committed (`812de18`) before anything ran on it.

- Jev experience question reworded: no job title, and "names no kind of work → yes".
- One dev label revised after review (Priya "building REST APIs": she consumed APIs, not built them).
- `npm run sweep` searched 2,280 policies on dev, keeping only those with zero false-skips and zero
  false-applies. I took the smallest change (2 knobs: stretch 0 → 0.5, hard-gap penalty 0.15 → 0)
  instead of the top result (4 knobs, +1 dev case).

| dev (n=40, tuned on) | rules | jev |
|---|---|---|
| Tier exact before → after | 22 → 32 | 26 → 30 |
| Requirement checks | 21/30 | 27/30 |

Finding: most tier errors were in the **policy**, not the facts. After tuning, rules caught up with Jev
on dev tiers, but Jev still judged single requirements far better.

## 4. Held-out, first and only clean run (policy frozen at `bc0c060`)

| held-out (n=18) | rules | jev |
|---|---|---|
| Tier exact | 5/18 (28%) | **10/18 (56%)** |
| Within one tier | 12/18 | **17/18** |
| Requirement checks | 3/16 | **12/16** |
| False-skip / false-apply | 1/6 · 0/12 | 1/6 · 0/12 |
| Blocker recall · precision | 2/3 · 2/5 | 3/3 · 3/6 |
| Latency / job | 0.06 ms | 209 ms |
| Calls / input tokens per job | 0 / 0 | 1 / ~2,100 |

The rules overfit: 80% on dev, 28% on data they'd never seen (a new specialty, IT support, whose tools and
titles aren't in their dictionaries). Jev generalized much better.

Causes of the remaining Jev errors, found by reading held-out results (so **not** tuned on):

1. **"Valid driver's license"** is extracted as a professional license. With "silence means no", it
   becomes a false blocker for all three candidates: 3 of Jev's 8 misses and every false blocker.
2. **Years only count technical job titles.** "IT Support Specialist" earns 0 years, so code vetoes Jev's
   correct "right kind of experience" answer. With Jev judging the kind, code should count all roles.
3. **Overqualification isn't modeled** (9 years vs "0-2 years" → apply).
4. **Different specialty, low bar** (data engineer → help desk) lands on stretch, not big_stretch.

Next: fix 1 and 2 as bugs and report the held-out score again, clearly marked as *after seeing
held-out*. A clean number after that needs a fresh held-out set.
