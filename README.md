# JevJob

**Which jobs should you actually apply to?** JevJob ranks job postings against your resume by asking one small,
typed question per requirement ("does this resume meet *Proficiency in Java or Python*?
meets / partial / not_stated / does_not_meet") instead of one big "rate this job 1-10" prompt. Plain code turns
those answers into a tier, and every rank is explained line by line.

<!-- Demo GIF goes here once recorded: docs/demo.gif -->

- **Ask in plain English from Claude or Codex:** `/jevjob junior software engineer in Chicago this week`. Postings
  come from the **Indeed** plugin (optional), employers' own career sites (Workday, Greenhouse, Oracle Cloud, iCIMS,
  and more, read directly), and for entry-level searches the community new-grad list
  ([SimplifyJobs/New-Grad-Positions](https://github.com/SimplifyJobs/New-Grad-Positions), read at run time and
  credited). Without Indeed, the assistant's own web search fills in.
- **Five tiers**, shown as the rank number's color: 🟢 Apply · 🟡 Maybe · 🟠 Stretch · 🔴 Big stretch · 🟥 No.
- **Every requirement** shown in green (you meet it), yellow (unclear) or red (you don't), next to the resume line that proves it.
- **An aggressiveness slider** (Conservative ↔ Apply anyway) re-ranks instantly in the browser with zero model calls.
- **50 postings per batch**; **Load 50 more** (or `/jevjob more`) continues the same search without repeats.
- **Never** a "chance of being hired". Percentages are requirement coverage or classifier confidence.

## Why it's built this way

**Facts vs. policy.** Whether a resume meets a requirement is a *fact*. It's expensive (a model call), so it's
cached. Which tier the job lands in is *policy*: pure, deterministic code that re-runs on every slider move.
Swapping the fact source (rules ↔ Jev) while keeping the policy fixed is what makes the comparison below fair.

**Bounded classification, not generation.** [Jev](https://docs.typesafe.ai) (TypeSafe AI) answers typed Choice/Noul
questions with calibrated probabilities. The design follows its documented limits: code computes degree level and
months per job and hands Jev those facts ("Jev is not a calculator"); Jev judges which resume roles are the *kind*
of work a line asks for; negations like "A degree is **not** required" get their own question; low-confidence
answers become "unclear" instead of guesses. Details: [docs/architecture.md](docs/architecture.md).

**The chat model finds, Jev judges.** The Indeed plugin lives in Claude and Codex, so the assistant runs the
searches; JevJob plans them (city → nearby cities → the rest of the state → remote only), filters every listing
before a full posting is fetched, rebuilds the structure of plain-text descriptions, and ranks. The assistant never
grades a posting. See [docs/harness.md](docs/harness.md).

## Results

58 hand-labeled resume/job pairs: a 40-case **dev** set used for tuning, and an 18-case **held-out** set labeled
and committed before anything ran on it. Every number comes from `npm run eval`; the full story, including what
went wrong, is in the lab notebook [docs/eval-log.md](docs/eval-log.md).

| Held-out, first clean run (policy frozen at `bc0c060`) | Rules | Jev |
|---|---|---|
| Tier exactly right | 5/18 (28%) | **10/18 (56%)** |
| Within one tier | 12/18 | **17/18** |
| Single-requirement verdicts right | 3/16 | **12/16** |
| Latency per posting | 0.06 ms | 209 ms |
| Model calls per posting | 0 | 1 |

Since then, each change has been tuned on dev and reported next to held-out, which is no longer clean because its
errors were read. The current Jev (v2 questions with code-computed resume facts) gets 32/40 tiers and 29/30
requirement checks on dev, and 13/18 tiers, 18/18 within one tier and 15/16 checks on held-out. The rules scored
80% on the dev set they were tuned on and 28% on held-out: overfitting, shown in numbers.

## Run it

```bash
npm install
npm run web
```

Open http://localhost:3100, pick a sample candidate (all fictional) or drop a resume (PDF, DOCX, TXT, MD). For
Jev, copy `.env.example` to `.env` and add a TypeSafe or OpenRouter key. Without one, everything runs on rules.

To search live postings, register the MCP server in Claude or Codex ([docs/harness.md](docs/harness.md)) and ask:
`/jevjob junior software engineer in Chicago, last 7 days`, then `/jevjob more` for the next 50.

| Command | |
|---|---|
| `npm test` / `npm run typecheck` | unit tests (incl. an end-to-end MCP protocol test) and types |
| `npm run eval -- rules` · `npm run eval -- jev` | score an assessor on the labeled sets (`--dev` to tune without seeing held-out) |
| `npm run sweep` | search policy thresholds on dev only, with zero false-skips as a hard constraint |
| `npm run compare -- <candidate> <company>` | rules vs Jev, requirement by requirement |
| `npm run coverage` | how many postings in the current pool each assessor can read |
| `npm run jevjob -- find "<request>"` | terminal search of the companies Joboid tracks (no Indeed from a terminal) |

## Layout

```
packages/core     domain types, requirement extraction, posting normalizer, rules assessor, ranking policy (pure, no I/O)
packages/jev      Jev assessor: typed questions, resume facts, answer validation (Zod), confidence routing, cache
packages/eval     labeled datasets, metrics, report writer, policy sweep
packages/harness  Indeed/web search planning and filtering, geography, job pool, CLI and MCP server
apps/web          Next.js UI: streamed pipeline, ranked board, fit map, batches, resume-vs-posting detail
```
