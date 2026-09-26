# Using JevJob from a harness

JevJob searches public job boards and employer listings with Exa, extracts individual postings, checks filters, and loads the app's job pool. It does not need Joboid or a saved list of companies. Jev grades posting requirements against your resume; the harness coordinates the search.

## Search commands

Set `EXA_API_KEY` in this repository's `.env` or process environment. Keep keys out of commands, commits and logs.

```bash
npm run jevjob -- find "25 junior software engineer jobs in Chicago, last 7 days"
npm run jevjob -- search --title "software engineer" --location Chicago --days 14 --count 25
npm run jevjob -- "data analyst in Chicago, last week"
npm run jevjob -- find "pharmacy technician" --location "Boston, MA" --days 7 --strict-location
npm run jevjob -- more
npm run jevjob -- open
```

`find` and `search` are aliases; a quoted request without a command also searches. Plain requests support job title, seniority, a leading count, `in/near/around <location>`, remote, and windows such as `last 7 days`, `last week`, and `today`. Explicit flags override inferred filters. For complex requests, the harness can write a structured plan.

| Option | Meaning |
|---|---|
| `--title` | Job title instead of the request string |
| `--location` | City or state; `City, ST` helps identify an unknown city |
| `--days` | Positive rolling age limit, up to 365 days |
| `--posted` | Alternative: `24h`, `7d`, `30d`, `3month` |
| `--count` | Requested count, 1–200, default 25; not a promise |
| `--remote` | Also accept remote jobs in the requested search |
| `--strict-location` | No geographic expansion |
| `--max-queries` | Exa request budget, 1–6, default 5 |
| `--keep` | Add a plan and matches instead of replacing the pool |
| `--provider joboid` | Explicitly opt into tracked-company search |

`more` continues saved filters with further title/geography variants and excludes previously shown jobs. A successful batch replaces the displayed pool. Empty searches preserve the pool; a new empty search still saves the new filters for `more`. Provider failures preserve the pool and prior session. Switching providers requires a new search without `keep`.

## Location expansion

For Chicago, the default stages are:

1. Chicago.
2. Chicago metro, including Evanston, Naperville, Schaumburg, and Oak Brook.
3. Illinois.
4. Wisconsin, Indiana, Iowa, Missouri, and Kentucky.
5. United States, **remote only**.

The search stops when it has enough accepted listings or reaches its request budget. Broader stages retain role, seniority and date filters. `areasSearched` and `matchesByArea` disclose where matches came from. Nationwide results require explicit remote and U.S. (or worldwide) eligibility in location metadata; onsite U.S. jobs and unspecified/foreign remote jobs do not pass.

Some other major U.S. cities and state neighbors are mapped in `packages/harness/src/geography.ts`. Unknown cities stay within the requested geography rather than guessing a state; use `City, ST` for state and U.S.-remote expansion. Not every city has a metro map or every state a neighbor map. Explicit lists of unrelated locations stay as supplied. Strict mode disables widening.

## Validation and limits

- The public web is searched without an employer or board-domain allowlist.
- A single Schema.org `JobPosting` record is preferred. Otherwise, explicit metadata and a full job description in Exa page text are required.
- Public pages are read anonymously. Authentication walls and blocked pages are not bypassed. Indexed text can be used if public retrieval fails, with a diagnostic.
- Multi-job pages, incomplete descriptions/employers, known closures, expired postings, mismatched titles/levels, and unverified locations are rejected.
- Date limits require the posting's own date. An Exa index/publication timestamp does not prove when an employer posted a job. Undated postings are excluded when an age limit is requested.
- Canonical URLs and exact normalized employer/title/location combinations remove duplicates and mirrors. This can conservatively collapse distinct openings with identical metadata.
- Entry-level searches reject required experience of three or more years.
- Listings can still be stale or inaccurate. Source links are retained. No application or account sign-in is performed.

Responses include `examined`, `skipped`, `warnings`, `queries` and geographic diagnostics. `limited=true` means the requested count was not reached within the budget, not that no other jobs exist. Public search never claims global exhaustion (`exhausted` is false).

Exa calls use the configured account and can consume its credits. The default is at most five search requests, each with 10–50 results and bounded text content. No per-result LLM summaries are requested. Slow sites can make a search take several minutes; set the MCP tool timeout to 360 seconds if needed.

## MCP calls

Plain-language `find_jobs`:

```json
{"query":"25 junior software engineer jobs in Chicago, last 7 days"}
```

Structured `find_jobs`:

```json
{
  "titles": ["software engineer", "software developer"],
  "level": "entry",
  "locations": ["Chicago"],
  "days": 7,
  "count": 25,
  "location_mode": "expand",
  "max_queries": 5
}
```

Explicit fields override fields inferred from `query`. `location_mode: "strict"` disables widening. `provider` defaults to `exa`; missing/invalid credentials are reported, never silently replaced with tracked-company results.

| Tool | Purpose |
|---|---|
| `find_jobs` | Search and load public postings |
| `more_jobs` | Continue saved filters with additional queries and unseen matches |
| `load_jobs` | Import full postings obtained elsewhere |
| `open_app` | Start/open the app; an open app notices changed pools |
| `rank` | Rank against `resume_text` or `resume_path` |
| `status` | Pool count, Exa/Jev availability and default provider, without keys |
| `clear_jobs` | Clear the pool/session and return to fictional demo data |

The server exposes a `jevjob` MCP prompt with a `query` argument. Prompt/slash-command presentation depends on the harness; `/jevjob` is not a universal built-in Codex command. Once connected, ask: **“Use JevJob to find junior software engineer jobs in Chicago from the last 7 days.”**

## Connect a harness

Install dependencies with `npm install`. The stdio command is:

```text
node <jevjob>/node_modules/tsx/dist/cli.mjs <jevjob>/packages/harness/src/mcp.ts
```

Use absolute paths. The server locates this repository's `.env` independently of the caller's working directory.

**Codex:** add to `~/.codex/config.toml`:

```toml
[mcp_servers.jevjob]
command = "node"
args = ["C:/Users/adnan/Joboid/projects/jevjob/node_modules/tsx/dist/cli.mjs", "C:/Users/adnan/Joboid/projects/jevjob/packages/harness/src/mcp.ts"]
tool_timeout_sec = 360
```

Use your actual checkout path. Restart the MCP connection after configuration/server changes.

**Claude Code:** this repository's `.mcp.json` registers the server when opened from this folder. From another folder use the absolute stdio command with `claude mcp add jevjob -- ...`.

**Claude Desktop and other MCP clients:** register a stdio server with the same command and absolute arguments. Harnesses without MCP can use the CLI commands above.

References: [Exa search API](https://exa.ai/docs/reference/search), [JobPosting structured data](https://developers.google.com/search/docs/appearance/structured-data/job-posting), [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
