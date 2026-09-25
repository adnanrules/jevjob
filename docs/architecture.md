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

## Layout (grows by milestone)

```
jevjob/
├── fixtures/                 # fictional resume + postings + hand labels (inputs and answers kept apart)
├── packages/
│   ├── core/                 # M1: pure domain, no I/O. Types, extraction, rule assessor, policy, pipeline
│   ├── jev/                  # M3: Jev client behind the same Assessor interface as the rules
│   └── eval/                 # M2: dataset + metrics runner → writes real results files
├── apps/
│   ├── web/                  # M4: Next.js UI, animation, slider
│   └── mcp/                  # M5: MCP server + CLI so any harness can call rank_jobs
└── docs/
```

## Milestones

1. **Deterministic core** (now). Domain types, fixtures, rule-based extraction + assessment + policy, tests.
2. **Evaluation.** ~30–50 labeled resume/job pairs. Metrics: tier accuracy, blocker recall, false-skip rate,
   false-apply rate, latency, API calls per job. Baseline numbers for the rules.
3. **Jev.** Client + Zod-validated outputs, caching, retries. Replace one decision at a time and re-run the eval.
4. **Web UI.** Resume input, pipeline animation, ranked list with colored rank numbers, requirement
   lines colored green/yellow/red, detail view, aggressiveness slider.
5. **Harness integration.** MCP server (`rank_jobs`, `open_board`) for Claude Desktop/Code, Codex and oh-my-pi;
   a CLI fallback for harnesses without MCP; Joboid as a job provider.
6. **Ship.** README with demo GIF + real eval table, GitHub Actions CI, fixture-mode deploy.

## Current task

- [x] M1 · Domain types (`packages/core/src/domain.ts`)
- [x] M1 · Rule-based extraction: posting text → `Requirement[]`, resume text → `Resume`
- [x] M1 · Rule-based assessor: `Resume` + `Requirement` → `Assessment` (`npm run demo` prints it)
- [x] M1 · Policy: `AssessedJob` + aggressiveness → `RankedJob`, checked against `fixtures/expected.json`
- [ ] M2 · Eval: 30–50 labeled resume/job pairs, a metrics runner, real baseline numbers for the rules
