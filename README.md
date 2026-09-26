# JevJob

Ranks job postings against a resume using small, bounded classifications instead of one big
"rate this job" prompt. Every tier is explained by the individual requirements you meet, might meet, or miss.

> Work in progress. See [docs/architecture.md](docs/architecture.md) for the design and roadmap.

## Evaluation

40 hand-labeled resume/job pairs (4 fictional candidates Ã— 10 postings) live in
[packages/eval/dataset](packages/eval/dataset). `npm run eval` scores a system on them and writes
[packages/eval/results/](packages/eval/results). Every number reported about this project comes from those files, and [docs/eval-log.md](docs/eval-log.md) is the lab notebook explaining each run.

## Develop

```bash
npm install
npm test
npm run typecheck
```

Requires Node 20+. Copy `.env.example` to `.env` for API keys (not needed yet).
