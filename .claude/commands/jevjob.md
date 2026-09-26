---
description: Find jobs (Indeed plus employers' own career sites) and rank them against your resume in the JevJob app
argument-hint: "anything, e.g. 'junior swe in chicago this week', or 'more'"
---

Request: $ARGUMENTS

Use the `jevjob` MCP tools. Pass tool outputs through verbatim; never summarize, rank or judge postings yourself.

1. **Start.** For `more` (or "next", "50 more", "different jobs") call `more_jobs`. Otherwise call `start_search` with
   `request` set to the user's words. Infer titles, level, place and window from them; don't ask.
2. **Search Indeed** if the Indeed plugin is available. Follow `next`. For each search it names, call the Indeed
   plugin's `search_jobs` with that search and location (country_code "US"), and pass its raw output to
   `add_search_results` (include `search` and `location`). When it lists job ids under `fetch`, call Indeed
   `get_job_details` for each, and pass the raw outputs to `add_jobs` as `indeed_details`, several per call.
   If Indeed says you're rate-limited, skip ahead to step 3 instead of retrying.
3. **Career sites.** When `next` says so, or when Indeed isn't available, call `search_career_sites` (no arguments).
4. **Repeat** until a result reports `done` or `next` says every source is used up. JevJob skips Indeed areas that
   only repeat themselves and widens a short date window on its own; just follow `next`.
5. **Still short and no Indeed?** Use your own web search: find individual postings (prefer employer career sites),
   read each page, and pass them to `add_jobs` as `postings` with the full text.
6. **Open** with `open_app`. Reply in two lines: how many postings loaded (in-state vs remote, and if `widenedTo` is
   set, how many are outside the requested window), the main skip reasons, and that `/jevjob more` gets the next 50.

Locations work for any US city or state. Within about 50 miles of the city counts as near, even across a
state line (Jersey City for NYC); then the rest of the state; then remote US. Onsite jobs elsewhere are skipped. At most 50
postings per batch.
