# JevJob

Ranks job postings against a resume using small, bounded classifications instead of one big
"rate this job" prompt. Every tier is explained by the individual requirements you meet, might meet, or miss.

> Work in progress. See [docs/architecture.md](docs/architecture.md) for the design and roadmap.

## Evaluation

58 hand-labeled resume/job pairs live in [packages/eval/dataset](packages/eval/dataset): a 40-case **dev** set
used for tuning and an 18-case **held-out** set that was labeled and committed before anything ran on it.
`npm run eval` scores an assessor (`rules` or `jev`) and writes [packages/eval/results/](packages/eval/results).
Every number reported about this project comes from those files, and [docs/eval-log.md](docs/eval-log.md) is
the lab notebook explaining each run.

## Develop

```bash
npm install
npm test
npm run typecheck
```

Requires Node 20+. For Jev, copy `.env.example` to `.env` and add a TypeSafe or OpenRouter key.
