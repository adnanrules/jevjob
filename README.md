# JevJob

Ranks job postings against a resume using small, bounded classifications instead of one big
"rate this job" prompt. Every tier is explained by the individual requirements you meet, might meet, or miss.

> Work in progress. See [docs/architecture.md](docs/architecture.md) for the design and roadmap.

## Develop

```bash
npm install
npm test
npm run typecheck
```

Requires Node 20+. Copy `.env.example` to `.env` for API keys (not needed yet).
