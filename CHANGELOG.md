# Changelog

## 1.1.0

- **Any US city or state.** "Near you" is now measured by distance on a map of every US city, town and township
  (US Census Bureau data) instead of hand-made suburb lists. Within 50 miles counts as near, across state lines
  (Jersey City for NYC, Gary for Chicago); "within 25 miles" changes the radius. Then the rest of the state, then
  remote. Indeed's nearby searches use the largest cities within the radius. Posting locations are read in any common
  format ("US-IL-Chicago", "Chicago, Illinois, United States", "Hoboken, NJ; Remote").
- **README** with screenshots and step-by-step setup for Claude Desktop and Codex.

## 1.0.0

First public release.

- **Ranking.** Every requirement in a posting is classified against your resume with Jev (TypeSafe AI): one bounded
  question per requirement, with a confidence. A deterministic policy turns those facts into five tiers (Apply, Maybe,
  Stretch, Big stretch, No). The aggressiveness slider re-ranks in the browser with no model calls. Without a key, a
  rules engine does the same job less accurately.
- **Web app.** Upload or paste a resume (PDF, DOCX, TXT, MD), watch postings rank live, read each requirement colored
  by verdict, open the full posting, and apply on the employer's site. Batches of 50, with "Load 50 more".
- **Search from Claude or Codex** (`/jevjob junior software engineer in Chicago, last 30 days`) over MCP:
  - the Indeed plugin, with saturation detection so repeated searches stop early;
  - the community new-grad list (SimplifyJobs/New-Grad-Positions), read at run time and credited;
  - each posting read from the employer's own system: Workday, Greenhouse, Lever, Ashby, SmartRecruiters, Workable,
    Oracle Cloud HCM, iCIMS, Rippling, Amazon, Microsoft, IBM, or schema.org JobPosting data on any other site;
  - places widen from the city to nearby cities, the state, then remote US; a short "posted within" window widens
    step by step, and those postings are tagged.
- **Eval.** Dev and held-out case sets, `npm run eval`, and a lab notebook of every reported number
  (`docs/eval-log.md`).
