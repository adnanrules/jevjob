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
        └─ open_app            the app ranks them with Jev, 50 at a time
```

The assistant never judges a posting; it passes tool outputs through. If the Indeed plugin isn't installed (or you
say "not Indeed"), it uses its own web search instead: it reads individual postings, preferring employer career
sites, and passes their full text to `add_jobs` as `postings`.

## Where it looks

The requested city first, then nearby cities (for Chicago: Naperville, Schaumburg, Evanston, Oak Brook, Deerfield,
Joliet), then the rest of the state, then **remote only**. A posting in another state is accepted only when it's
remote, and in-state postings always come first. Say "only in Chicago" (`strict_location`) to stop the widening.

## Tools

| MCP tool | What it does |
|---|---|
| `start_search` | Plans a new search from the user's words; returns the searches to run, in order, and `next` |
| `add_search_results` | One raw Indeed `search_jobs` output; answers which job ids to fetch |
| `add_jobs` | Raw Indeed `get_job_details` outputs (`indeed_details`), or web-search postings (`postings`) |
| `more_jobs` | Next 50 with the same search, never repeating a posting |
| `open_app` | Starts the web app if needed; an open app notices new postings and offers to rank them |
| `rank` | Compact results in chat, for when you don't want the app |
| `status` / `clear_jobs` | The current pool and search; forget them |

The server also exposes a `jevjob` prompt, and Joboid's `.claude/commands/jevjob.md` makes `/jevjob` in Claude Code.

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
