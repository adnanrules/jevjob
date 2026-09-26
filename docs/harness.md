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

The requested city first, then nearby cities (for Chicago: Naperville, Schaumburg, Evanston, Oak Brook, Deerfield,
Joliet), then the rest of the state, then **remote only**. A posting in another state is accepted only when it's
remote, and in-state postings always come first. Say "only in Chicago" (`strict_location`) to stop the widening.

## When the search runs short

The Indeed plugin draws from a small index: it returns 10 postings per search, and past a point every search in an
area returns the same ones. So a short search degrades in a fixed order instead of stopping at 2 postings:

1. **Saturation.** An Indeed search that adds fewer than 2 new postings is "dry". Two dry searches in a row skip
   that area; four in a row skip every local area and go straight to remote (a different pool).
2. **Career sites.** Once Indeed is used up (or right away without Indeed), `search_career_sites` reads employers'
   own postings, with the same checks as Indeed:
   - **New-grad feed** (entry-level and any-level searches): the community list
     [SimplifyJobs/New-Grad-Positions](https://github.com/SimplifyJobs/New-Grad-Positions), about a thousand active
     new-grad roles a month, each linking to the employer's own posting. JevJob filters it by role family, place and
     date, then reads each posting from the employer's system (`packages/harness/src/readers/`): the public APIs of
     Workday, Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Oracle Cloud HCM, iCIMS and Rippling, the Amazon,
     Microsoft and IBM job search APIs, and schema.org JobPosting data on any other site. Postings are cached for a
     day. The list has no license, so it's downloaded at run time (cached 6 hours) and credited, never committed here.
   - **Optional, Joboid's followed companies:** if [Joboid](#optional-joboid) is installed and `JOBOID_DIR` points at
     it, JevJob also searches the companies it follows (at most 80 postings per call, in-window first).
3. **Widening.** Still short, and the user gave a "posted within" window? Postings that missed only on date were
   held back all along. The window widens one step at a time (7 → 14 → 30 days; never past 4× the request, or 30
   days for short windows) and releases them. Each carries `outsideWindowDays`, shows a dashed "12d · outside 7d"
   tag in the app, and ranks below in-window jobs of the same tier. A step that would add nothing isn't taken.

Every tool result reports `saturated` areas and `widenedTo`, so the assistant can say why a batch is short.

## Tools

| MCP tool | What it does |
|---|---|
| `start_search` | Plans a new search from the user's words; returns the searches to run, in order, and `next` |
| `add_search_results` | One raw Indeed `search_jobs` output; answers which job ids to fetch |
| `add_jobs` | Raw Indeed `get_job_details` outputs (`indeed_details`), or web-search postings (`postings`) |
| `search_career_sites` | Employers' own career sites and the new-grad list; no arguments |
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

