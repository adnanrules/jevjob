# JevJob architecture

## The one idea: facts vs. policy

JevJob splits "does this resume fit this job?" into two layers that never mix:

| | **Facts** (assessment) | **Policy** (ranking) |
|---|---|---|
| Question | "Does the resume meet *this one requirement*?" | "Given those answers, which tier is this job?" |
| Output | `meets` / `unclear` / `does_not_meet` per requirement, plus evidence | `apply` / `maybe` / `stretch` / `big_stretch` / `no`, plus a sort order |
| Decided by | rules today, Jev later (bounded labels, never free text) | plain deterministic TypeScript |
| Cost | slow, may call an API, **cached** | instant, free, pure function |
| Changes when | the resume or the posting changes | the user moves the aggressiveness slider |

Why this matters:
- **The slider is free.** Moving it only re-runs policy over cached facts, so the re-sort animation is instant and makes zero API calls.
- **Jev can be measured.** Swap the fact source (rules ↔ Jev), keep policy fixed, run the same eval. Any difference in the numbers comes from Jev.
- **Every tier is explainable.** A tier is always traceable to specific green/yellow/red requirements.
- **No fake probabilities.** Percentages are only requirement coverage or classifier confidence, never "chance of being hired".

## Data flow

```
provider ──► normalize ──► extract requirements ──► assess each requirement ──► policy(aggressiveness) ──► ranked jobs
(fixtures,    (one Job     (posting → Requirement[]:  (rules | Jev; cached)        (pure; re-runs on          (web UI,
 Joboid,       shape)       skill/education/                                        slider change)             MCP, CLI)
 harness LLM)               experience/eligibility,
                            required vs preferred)
```

The harness LLM (Claude, Codex, …) only *finds* jobs, which is cheap for it. Jev does the many small
bounded classifications (jobs × requirements), and deterministic code does the rest. That split is the cost
argument: the expensive general model stops doing repetitive grading work.

## Layout

```
jevjob/
├── fixtures/                 # fictional resume + postings + hand labels (inputs and answers kept apart)
├── packages/
│   ├── core/                 # pure domain, no I/O: types, extraction, rules assessor, policy, ingestion
│   ├── jev/                  # Jev assessor behind the same Assessor interface as the rules
│   ├── eval/                 # dev + held-out datasets, metrics, reports, policy sweep
│   └── harness/              # job pool, Joboid import, CLI and MCP server
├── apps/
│   └── web/                  # Next.js UI: streamed pipeline, ranked board, detail view, slider
└── docs/                     # architecture, eval lab notebook, harness setup
```

## Milestones

- [x] **M1 · Deterministic core.** Domain types, fixtures, rules extraction + assessment + policy, tests.
- [x] **M2 · Evaluation.** 40 dev + 18 held-out labeled pairs; tier accuracy, within-one, false-skip,
  false-apply, blocker recall/precision, requirement checks, latency, calls and tokens per job.
- [x] **M3 · Jev.** Typed questions, Zod-validated answers, confidence routing, response cache, per-role
  experience judgments. Compared against rules in [eval-log.md](eval-log.md).
- [x] **M4 · Web UI.** Streamed pipeline animation, verdict barcodes, colored ranks, live slider re-rank,
  resume-vs-posting detail view.
- [x] **M5 · Harness.** MCP server + CLI (load postings, live Joboid import, open app, headless rank);
  see [harness.md](harness.md).
- [x] **M6 · 1.0.** Standalone: career-site readers in TypeScript (no Joboid needed), `npm run setup`, MIT license.
- [ ] **M7 · Ship.** Demo video/GIF, push to GitHub, CI green, a fresh held-out set for a clean post-fix number.

## How Jev is used (and why)

One Jev call per job. The state is the resume; each requirement becomes its own small question, and Jev
answers all of them in parallel. The design follows TypeSafe's documented limits for Jev 1.13:

| Decision | Why |
|---|---|
| Rules still extract requirements | Jev classifies; it doesn't generate text. |
| Years of experience are compared in code; Jev only judges the *kind* of experience (Noul) | "Jev is not a calculator." |
| A separate "does this line require anything?" Noul for every required line | Negation ("A degree is not required") is a known weak spot, so it gets its own affirmatively phrased question. |
| Four verdict labels, including `not_stated` | Separates "resume is silent" (citizenship) from "resume would list it and doesn't" (Kubernetes). |
| Answers under `JEV_POLICY.minConfidence` become `unclear` | The docs' confidence-routing pattern: don't act on a flat distribution. |
| Zod validates every answer; bad or missing answers fall back to the rules verdict | A server change degrades to the baseline instead of breaking the UI. |
| Responses cached by a hash of (model, state, questions) | Re-running the eval costs nothing; any prompt change invalidates the cache automatically. |
