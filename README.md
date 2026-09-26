# JevJob

**Which jobs should you actually apply to?** JevJob ranks job postings against your resume by asking one small,
typed question per requirement ("does this resume meet *Proficiency in Java or Python*?
meets / partial / not_stated / does_not_meet") instead of one big "rate this job 1-10" prompt. Plain code turns
those answers into a tier, and every rank is explained line by line.

<!-- Demo GIF goes here once recorded: docs/demo.gif -->

- **Five tiers**, shown as the rank number's color: 🟢 Apply · 🟡 Maybe · 🟠 Stretch · 🔴 Big stretch · 🟥 No.
- **Every requirement** shown in green (you meet it), yellow (unclear) or red (you don't), next to the resume line that proves it.
- **An aggressiveness slider** (Conservative ↔ Apply anyway) re-ranks instantly in the browser with zero model calls.
- **Search public job boards and employer listings with Exa**, without a saved-company allowlist. Links open the source posting so you can verify details and apply.
- **Never** a "chance of being hired". Percentages are requirement coverage or classifier confidence.

## Why it's built this way

**Facts vs. policy.** Whether a resume meets a requirement is a *fact*. It's expensive (a model call), so it's
cached. Which tier the job lands in is *policy*: pure, deterministic code that re-runs on every slider move.
Swapping the fact source (rules ↔ Jev) while keeping the policy fixed is what makes the comparison below fair.

**Bounded classification, not generation.** [Jev](https://docs.typesafe.ai) (TypeSafe AI) answers typed Choice/Noul
questions with calibrated probabilities. The design follows its documented limits: years of experience are
added up in code ("Jev is not a calculator"), Jev only judges which resume roles are the *kind* of work a line
asks for, negations like "A degree is **not** required" get their own question, and low-confidence answers
become "unclear" instead of guesses. Details: [docs/architecture.md](docs/architecture.md).

**Cheap for your chat model.** As an MCP server, JevJob lets Claude, Codex or oh-my-pi *find* postings while
Jev does the repetitive per-requirement grading at one call per posting. See [docs/harness.md](docs/harness.md).

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

After fixing two bugs *found by reading those held-out errors* (so no longer a clean measurement), Jev reached
14/18 exact and 18/18 within one tier, with no false skips and no false blockers. The rules scored 80% on the dev
set they were tuned on and 28% on held-out: overfitting, shown in numbers.

## Run it

```bash
npm install
npm run web
```

Open http://localhost:3100, pick a sample candidate (all fictional) or paste a resume, and run the machine. For
Jev, copy `.env.example` to `.env` and add a TypeSafe or OpenRouter key. Without one, everything runs on rules.

For public job search, set `EXA_API_KEY` in `.env`, then:

```bash
npm run jevjob -- find "25 junior software engineer jobs in Chicago, last 7 days"
npm run jevjob -- open
```

Chicago widens when there are too few matches: city → metro → Illinois → Wisconsin/Indiana/Iowa/Missouri/Kentucky → U.S. remote only. Use `--strict-location` to keep the requested geography. Searches report areas, rejected listings and missing dates.

You can also pass explicit filters, use a bare request string, or call `find_jobs` from an MCP harness:

```bash
npm run jevjob -- search --title "software engineer" --location Chicago --days 14 --count 25
npm run jevjob -- "data analyst in Chicago, last week"
npm run jevjob -- more
```

The default is Exa public search. Saved-company search remains available explicitly with `--provider joboid` (or the legacy `joboid` command). [Harness setup and search behavior](docs/harness.md).

| Command | |
|---|---|
| `npm test` / `npm run typecheck` | unit tests (incl. an end-to-end MCP protocol test) and types |
| `npm run eval -- rules` · `npm run eval -- jev` | score an assessor on the labeled sets |
| `npm run sweep` | search policy thresholds on dev only, with zero false-skips as a hard constraint |
| `npm run compare -- <candidate> <company>` | rules vs Jev, requirement by requirement |
| `npm run demo` | the ranking in the terminal |

## Layout

```
packages/core     domain types, requirement extraction, rules assessor, ranking policy, ingestion (pure, no I/O)
packages/jev      Jev assessor: typed questions, answer validation (Zod), confidence routing, response cache
packages/eval     labeled datasets, metrics, report writer, policy sweep
packages/harness  public search, geographic expansion, job pool, CLI and MCP server
apps/web          Next.js UI: streamed pipeline animation, ranked board, resume-vs-posting detail view
```
