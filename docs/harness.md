# Using JevJob from a harness

The idea: your chat model (Claude, ChatGPT/Codex, oh-my-pi…) is good at finding postings and talking to you,
but grading every bullet of every posting against your resume burns a lot of its usage. JevJob takes over
that repetitive part: one Jev call per posting, each answering small typed questions, while plain code does
the ranking.

```
you ─▶ harness LLM ─▶ JevJob MCP tools ─▶ Jev (1 call / posting) ─▶ ranked board in your browser
          │                 ▲
          └─ finds postings ┘  (the model writes a search plan; find_jobs does the finding with no LLM tokens)
```

## Tools (MCP) and commands (CLI)

| MCP tool | CLI (`npm run jevjob -- …`) | What it does |
|---|---|---|
| `find_jobs` | `find "<what>" [--location L] [--remote] [--posted 24h\|7d\|30d\|3month] [--count N] [--keep]` | Runs a search plan (titles, level, locations incl. suburbs, remote, window, count) against every company Joboid tracks, checks each full posting, and discovers more companies when results are thin. In a harness the chat model writes the plan; the CLI builds one from keywords |
| `more_jobs` | `more` | Reruns the same plans and swaps in postings you haven't seen yet |
| `load_jobs` | `load <file.json\|->` | Postings the harness found itself. A new search replaces the pool unless `keep`/`replace=false` |
| `open_app` | `open` | Starts the web app if needed and opens it in your browser |
| `rank` | `rank <resume.md> [--engine jev\|rules] [--top N] [--json]` | Compact ranking for the chat: tiers, apply links, blockers, gaps |
| `status` | `status` | Where the pool comes from, how many postings, whether Jev is configured |
| `clear_jobs` | `clear` | Forget loaded postings; the app goes back to its fictional demo pool |

Postings are validated on the way in: they need a description and an http(s) apply link, closed postings are
rejected, and duplicates are merged by id. A new search replaces the previous pool. `posted` is enforced on each
full posting's own date (Joboid's search keeps undated postings, so JevJob fetches extra candidates and keeps going
until enough fall inside the window).

**The open app follows the pool.** It checks for a new pool every few seconds. On the start screen the count just
updates; on a ranked board a notice offers to re-rank with the same resume. So you can leave the app open and
run `/jevjob …` or `/jevjob more` from your chat as often as you like.

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

**oh-my-pi and other MCP clients**: register a stdio server with the same command and arguments.

**No MCP?** Any harness that can run shell commands can use the CLI.

## A typical session

> "Find junior software engineer jobs in Chicago and open JevJob."

The harness calls `import_from_joboid({ query: "junior software engineer", location: "Chicago" })`, then
`open_app()`. You paste your resume and watch the board rank itself. Or, for a chat-only answer:
`rank({ resume_path: "…/resume.md", top: 5 })` returns a compact summary of about one line per job.
