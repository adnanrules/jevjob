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

## 5. Bug fixes, AFTER seeing held-out (not a clean measurement)

- Requirement extraction: "driver's license" no longer counts as a professional license.
- Experience is now composed from atomic questions: code parses each resume role (title, bullets, dates),
  Jev answers one yes/no per role ("is this role the kind of work the line asks for?"), and code adds up
  the months of qualifying roles, counting overlapping months once. The rules keep their title heuristic.

No thresholds were tuned in this entry.

| | rules | jev |
|---|---|---|
| Held-out tier exact (entry 4 → now) | 5/18 → 5/18 | 10/18 → **14/18 (78%)** |
| Held-out within one tier | 12/18 → 11/18 | 17/18 → **18/18** |
| Held-out false-skip | 1/6 → 1/6 | 1/6 → **0/6** |
| Held-out blocker precision | 2/5 → 2/2 | 3/6 → **3/3** |
| Held-out requirement checks | 3/16 → 4/16 | 12/16 → 15/16 |
| Dev tier exact | 32/40 → 32/40 | 30/40 → 30/40 |
| Input tokens per job (held-out) | 0 | ~2,100 → ~2,340 (one extra Noul per role) |

Because these fixes were found by reading held-out errors, the 14/18 is optimistic. The clean held-out number
remains entry 4's 10/18. The honest claim is that the fixes addressed the diagnosed causes without hurting dev.
A fresh held-out set is needed before calling any later number clean.

## 6. Real postings: requirement coverage (extraction cascade)

The labeled sets all have tidy requirements sections, so they can't measure this. Real postings often don't:
header wording varies, or the qualifications are loose sentences. When the rules find fewer than 3 required
items, Jev now classifies every candidate line of the posting (required / preferred / duty / other) and the
usual per-requirement questions run on what it found. That first call depends only on the posting, so it's
cached across resumes.

Measured with `npm run coverage` on 50 live postings from Joboid ("software engineer": 25 Chicago, 25 remote):

| | rules | jev |
|---|---|---|
| Postings with no requirements found | 13/50 | **3/50** |
| Jev calls | 0 | 65 (15 postings needed the extra extraction call) |

Spot checks of the extracted lines looked right (C/C++, Linux internals, kernel hardening as required; "strong
background in scalable systems" as preferred). The dev and held-out numbers are unchanged, because every labeled
posting has at least 3 rule-extracted requirements and never takes the new path. This measures coverage, not
accuracy. Accuracy on messy postings needs its own labeled set.

## 7. Presenting resumes to Jev better (v2 questions), tuned on dev

Dev-set errors showed Jev answering too harshly on close relatives (JavaScript for a TypeScript requirement came back
does_not_meet) and missing alternatives a requirement allows (a math degree for "CS or a related field"). Two changes:

- **Facts in the state.** Next to the resume text, Jev now gets what code already computed: highest degree, education
  lines, each job with its length in months, years across all jobs, and the skills detected. Jev reads dates as
  text, so it shouldn't be doing that arithmetic.
- **Clearer answer definitions.** "meets" includes alternatives the requirement itself allows; "partial" names close
  relatives and projects-instead-of-professional-use; "not_stated" lists what resumes usually omit.
- **Confidence cutoff** swept on dev (0.2 to 0.6, cached answers, no new calls): 0.3 instead of 0.5.

| | before (entry 5) | v2 |
|---|---|---|
| Dev tier exact | 30/40 | **32/40** |
| Dev requirement checks | 26/30 | **29/30** |
| Held-out tier exact (not clean, see entry 5) | 14/18 | 13/18 |
| Held-out requirement checks | 15/16 | 15/16 |

Per-requirement accuracy, the part Jev controls, went up on dev and held steady on held-out. The one held-out tier
that got worse (a data engineer for an NLP role, now stretch instead of big_stretch) is the known "different
specialty" weakness of the policy. It's a policy problem, not a Jev one. With 18 held-out cases, one case is within
noise, and a fresh held-out set is still owed before calling any number clean.
