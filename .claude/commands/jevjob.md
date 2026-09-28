---
description: Find jobs on employers' own career sites (plus Indeed if you have it) and rank them against your resume in the JevJob app
argument-hint: "anything, e.g. 'junior swe in chicago this week', or 'more'"
---

Request: $ARGUMENTS

Use the `jevjob` MCP tools. Pass tool outputs through verbatim; never summarize, rank or judge postings yourself.

1. **Start.** For `more` (or "next", "50 more", "different jobs") call `more_jobs`. Otherwise call `start_search` with
   `request` set to the user's words. Infer titles, level, place and window from them; don't ask.
2. **Career sites.** Call `search_career_sites`: employers' own sites (the new-grad list and thousands of company job
   boards, any level). Pass `indeed_unavailable: true` if you don't have the Indeed plugin.
3. **Indeed, if `next` asks.** For each search it names, call the Indeed plugin's `search_jobs` with that search and
   location (country_code "US"), and pass its raw output to `add_search_results` (include `search` and `location`).
   When it lists job ids under `fetch`, call Indeed `get_job_details` for each, and pass the raw outputs to `add_jobs`
   as `indeed_details`, several per call. If Indeed is rate-limited, call `search_career_sites` again with
   `indeed_unavailable: true` instead of retrying.
4. **Repeat** until a result reports `done` or `next` says every source is used up. JevJob widens a short date window
   on its own; just follow `next`.
5. **Open** with `open_app`. Reply in two lines: how many postings loaded (near you vs remote, and if `widenedTo` is
   set, how many are outside the requested window), the main skip reasons, and that `/jevjob more` gets the next 50.

Locations work for any US city or state. Within about 50 miles of the city counts as near, even across a
state line (Jersey City for NYC); then the rest of the state; then remote US. Onsite jobs elsewhere are skipped. At most 50
postings per batch.
