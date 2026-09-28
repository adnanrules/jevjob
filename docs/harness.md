# Using JevJob from Claude or Codex

JevJob officially supports **Claude (Desktop and Code) and Codex**, the harnesses that ship an Indeed plugin. The
Indeed plugin lives in the chat app, so JevJob can't call it; the assistant does, and hands JevJob the plugin's raw
output. JevJob does the rest:

```
you ─▶ /jevjob junior swe in Chicago this week
        │
        ├─ start_search        JevJob plans: titles, level, and places in widening order
        ├─ Indeed search_jobs  ─▶ add_search_results   JevJob drops wrong titles/levels/places/dates/duplicates
        │                                              and answers "fetch these ids"
        ├─ Indeed get_job_details ─▶ add_jobs          full postings: structure rebuilt, 3+ years (entry level),
        │                                              in-state first, loaded into the app
        ├─ search_career_sites JevJob reads employers' own career sites (direct apply links)
        └─ open_app            the app ranks them with Jev, 50 at a time
```

The assistant never judges a posting; it passes tool outputs through. The Indeed plugin is optional: without it (or
when it's rate-limited) the assistant goes straight to `search_career_sites`, and if that's still short, uses its own
web search to read individual postings and pass their full text to `add_jobs` as `postings`.

## Where it looks

Any US city or state, by distance, with no hand-made lists. `places.ts` resolves the request ("NYC", "Raleigh, NC",
"the Bay Area", "Texas") on a table of every US city, town and township from the Census Bureau
(`packages/harness/data/us-places.tsv.gz`, rebuilt by `npm run build:places`), and reads each posting's location
("US-IL-Chicago", "Chicago, Illinois, United States", "Hoboken, NJ; Remote") onto the same map. Then:

| Placement | Meaning | Order |
|---|---|---|
| near | within 50 miles of the city, **in any state** (Jersey City for NYC, Gary for Chicago); "within 25 miles" changes it | first |
| state | elsewhere in the same state | second |
| remote | US-remote, from anywhere | third |
| no | onsite somewhere else, or remote tied to another country | skipped |

Indeed searches follow the same order: the city, the three largest cities within the radius (found on the map, 12+
miles apart so each search covers new ground), the state, then remote. Say "only in Chicago" (`strict_location`) to
stay within the radius.

## Where postings come from

`search_career_sites` runs first, because employers' own sites are fast, have no rate limits, and give direct apply
links. Indeed (if the assistant has it) tops up what's still missing. Every source goes through the same checks:
title and level, place, date window, 3+ years of experience for entry-level searches, duplicates.

1. **New-grad list** (entry-level and any-level searches): the community list
   [SimplifyJobs/New-Grad-Positions](https://github.com/SimplifyJobs/New-Grad-Positions), about a thousand active
   new-grad roles a month. Every row is new-grad, so its level is trusted (some employers title new-grad roles
   "Engineer II"); only unmistakably senior titles are dropped. The list has no license, so it's downloaded at run
   time (cached 6 hours) and credited, never committed here.
2. **Company boards** (`boards.ts`, every search, any level): the new-grad and internship lists link to about 4,500
   employers' own job boards on Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Rippling and Workday. That's a
   directory of employers that hire tech people, and where they've hired. For a search, JevJob picks the boards that
   hire near you, in your state, or remotely (up to ~570), pulls every open job from each board's public API (cached 12
   hours; `start_search` starts this in the background), and keeps the ones that fit. This is what makes senior, IT,
   data and other non-new-grad searches work.
3. **Optional, Joboid's followed companies:** if [Joboid](#optional-joboid) is installed and `JOBOID_DIR` points at
   it, JevJob also searches the companies it follows.
4. **Indeed** tops up. An Indeed search that adds nothing usable is "dry"; two dry searches in a row skip that area.

Full postings are read from the employer's system (`packages/harness/src/readers/`): the public APIs of Workday,
Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Oracle Cloud HCM, iCIMS and Rippling; the Amazon, Microsoft, IBM
and Apple job APIs; schema.org JobPosting data; and for server-rendered pages without it (TikTok, Google, TalentBrew
sites) the posting's own sections, from its first heading to where the page's chrome resumes. Read postings are
cached for a day.

**Time limit.** One `search_career_sites` call stops after about 40 seconds (assistants usually allow a tool about a
minute) and keeps what it found; `next` then says to call it again, up to three passes. Nothing is read twice.

**Widening.** Still short, and the user gave a "posted within" window? Postings that missed only on date were held
back all along. The window widens one step at a time (7 → 14 → 30 days; never past 4× the request, or 30 days for
short windows) and releases them. Each carries `outsideWindowDays`, shows a dashed "12d · outside 7d" tag in the app,
and ranks below in-window jobs of the same tier.

`npm run bench:search` runs a fixed set of searches (Chicago junior SWE, Austin entry data analyst, remote new-grad ML,
Seattle SWE, NYC senior backend, Denver IT support, Raleigh data engineer) the way a new user would, and reports what
each finds, so changes to search can be compared.

## Tools

| MCP tool | What it does |
|---|---|
| `start_search` | Plans a new search from the user's words; returns the searches to run, in order, and `next` |
| `add_search_results` | One raw Indeed `search_jobs` output; answers which job ids to fetch |
| `add_jobs` | Raw Indeed `get_job_details` outputs (`indeed_details`), or web-search postings (`postings`) |
| `search_career_sites` | Employers' own sites: the new-grad list and ~4,500 company boards. `indeed_unavailable: true` skips Indeed |
| `more_jobs` | Next 50 with the same search, never repeating a posting |
| `open_app` | Starts the web app if needed; an open app notices new postings and offers to rank them |
| `rank` | Compact results in chat, for when you don't want the app |
| `status` / `clear_jobs` | The current pool and search; forget them |

The server also exposes a `jevjob` prompt, and `.claude/commands/jevjob.md` makes `/jevjob` in Claude Code.

## Setup

The server is plain stdio: `node <jevjob>/node_modules/tsx/dist/cli.mjs <jevjob>/packages/harness/src/mcp.ts`.
Replace `<jevjob>` with this folder's absolute path. Jev uses the key in this folder's `.env`.

**Claude Code**: this repo's [`.mcp.json`](../.mcp.json) registers it when you open the folder. From anywhere else:

```bash
claude mcp add jevjob -- node <jevjob>/node_modules/tsx/dist/cli.mjs <jevjob>/packages/harness/src/mcp.ts
```

**Claude Desktop**: add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jevjob": {
      "command": "node",
      "args": ["<jevjob>/node_modules/tsx/dist/cli.mjs", "<jevjob>/packages/harness/src/mcp.ts"]
    }
  }
}
```

**Codex**: add to `~/.codex/config.toml`:

```toml
[mcp_servers.jevjob]
command = "node"
args = ["<jevjob>/node_modules/tsx/dist/cli.mjs", "<jevjob>/packages/harness/src/mcp.ts"]
```

Enable the Indeed plugin in the same app (Claude: Settings → Connectors; Codex: its plugin list).

## From a terminal

A terminal can't reach Indeed, so `npm run jevjob -- find "<request>"` searches the companies Joboid tracks
instead. `load`, `open`, `rank`, `status` and `clear` work the same as the MCP tools.

## Optional: Joboid

Joboid is the author's separate job-search tool (Python); JevJob doesn't need it. With `JOBOID_DIR` set in `.env`,
`search_career_sites` also searches the companies Joboid follows, and `npm run jevjob -- find "<request>"` searches
them from a terminal.

