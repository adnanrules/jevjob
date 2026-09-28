// JevJob as an MCP server for Claude (Desktop/Code) and Codex.
// Jobs come from the Indeed plugin in the chat app by default, or from the model's own web search when Indeed
// isn't installed. The model runs those tools and hands JevJob their raw output; JevJob plans the search, filters
// every listing, decides which full postings are worth fetching, and ranks them with Jev. The model never judges fit.
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addJobs, addSearchResults, APP_URL, BATCH_SIZE, clearJobs, currentJobs, jevAvailable, moreFromSearch, openApp, planFromQuery,
  joboidDir, rankResume, refreshInBackground, searchCareerSites, searchStatus, startSearch, validatePlan, warmBoards, type SearchPlan,
} from "./index";

const WORKFLOW = [
  "Workflow: (1) start_search with the user's request. (2) Call search_career_sites: employers' own career sites (the",
  "community new-grad list and thousands of company job boards, any level), with direct apply links. Pass",
  "indeed_unavailable: true if you don't have the Indeed plugin. (3) If `next` names Indeed searches: call Indeed",
  "search_jobs (country_code US) for each and pass the raw output to add_search_results; it answers with job ids to fetch;",
  "call get_job_details for those and pass the raw outputs to add_jobs (several per call is fine). If Indeed is",
  "rate-limited, call search_career_sites again with indeed_unavailable: true. (4) Follow `next` until it says done or",
  "that every source is used up, then open_app. JevJob widens a short 'posted within' window step by step (tagging those",
  "postings), so just follow `next`. Pass tool output verbatim; never summarize or judge postings yourself.",
  "'more' or 'next 50' → more_jobs, then continue the same way.",
].join(" ");

const server = new McpServer(
  { name: "jevjob", version: "1.2.0" },
  {
    instructions: [
      "JevJob ranks job postings against a resume, one small typed classification per requirement, and shows them in a web app.",
      WORKFLOW,
      `At most ${BATCH_SIZE} postings per batch. Any US city or state: within 50 miles (any state) counts as near, then the rest of the state, then remote`,
      "only: postings in other states are accepted only if remote. Never claim a probability of being hired.",
    ].join(" "),
  },
);

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (err: unknown) => ({ isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }] });

server.registerTool(
  "status",
  { title: "JevJob status", description: "The current pool, the search behind it, and whether Jev is configured." },
  async () => {
    const { source, jobs } = currentJobs();
    return json({ source, jobs: jobs.length, jev: jevAvailable(), search: searchStatus(), app: APP_URL });
  },
);

server.registerTool(
  "start_search",
  {
    title: "Start a job search",
    description: [
      "Plan a new search from the user's words. Returns the Indeed searches to run, in order, and a `next` instruction.",
      "Infer everything; don't ask. Pass `request` as the user typed it; add fields only to correct the inference.",
      "`titles`: titles employers use for the role. `location`: the starting city ('Chicago, IL').",
      "`days`: posted within (1 = today, 7 = this week, 30, 90). `count`: at most 50 per batch.",
      WORKFLOW,
    ].join(" "),
    inputSchema: {
      request: z.string().min(2).optional().describe("The user's words, e.g. 'junior software engineer in Chicago, last 7 days'"),
      titles: z.array(z.string().min(2)).min(1).max(12).optional(),
      level: z.enum(["entry", "mid", "senior", "any"]).optional(),
      location: z.string().optional().describe("Any US city or state: 'Chicago', 'Raleigh, NC', 'NYC', 'Texas'; empty for anywhere"),
      radius_miles: z.number().positive().max(500).optional().describe("How far from the city still counts as near (default 50)"),
      remote: z.boolean().optional().describe("The user asked for remote jobs"),
      days: z.number().positive().max(365).optional(),
      count: z.number().int().min(1).max(BATCH_SIZE).optional(),
      strict_location: z.boolean().optional().describe("true: don't widen beyond the requested place"),
    },
  },
  async (input) => {
    try {
      if (!input.request && !input.titles) throw new Error("Pass the user's request (or titles).");
      const base: SearchPlan = input.request
        ? planFromQuery(input.request, { locationMode: input.strict_location ? "strict" : "expand" })
        : { titles: input.titles!, level: "any", locations: [], remote: false, count: BATCH_SIZE, locationMode: "expand" };
      const plan = validatePlan({
        ...base,
        ...(input.titles && { titles: input.titles }),
        ...(input.level && { level: input.level }),
        ...(input.location !== undefined && { locations: input.location ? [input.location] : [] }),
        ...(input.remote !== undefined && { remote: input.remote }),
        ...(input.days !== undefined && { days: input.days, posted: undefined }),
        count: Math.min(input.count ?? base.count ?? BATCH_SIZE, BATCH_SIZE),
        ...(input.strict_location !== undefined && { locationMode: input.strict_location ? "strict" : "expand" }),
        ...(input.radius_miles !== undefined && { radiusMiles: input.radius_miles }),
      });
      const joboid = joboidDir();
      if (joboid) refreshInBackground(joboid);
      warmBoards(plan); // start pulling company boards now, so search_career_sites finds them cached
      return json(startSearch({ ...plan, count: input.count ?? BATCH_SIZE }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "add_search_results",
  {
    title: "Add Indeed search results",
    description: "Pass one Indeed search_jobs result verbatim. Returns which job ids to fetch with get_job_details, and what to do next.",
    inputSchema: {
      result: z.string().min(10).describe("The raw search_jobs output"),
      search: z.string().optional().describe("The search text you used"),
      location: z.string().optional().describe("The location you used"),
    },
  },
  async ({ result, search, location }) => {
    try {
      return json(addSearchResults(result, search && location ? { title: search, location } : undefined));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "add_jobs",
  {
    title: "Add full job postings",
    description:
      "Pass Indeed get_job_details outputs verbatim in `indeed_details` (several at once is fine), or, without Indeed, postings you read with your own web search in `postings`. JevJob checks level, location and dates and loads the ones that fit.",
    inputSchema: {
      indeed_details: z.array(z.string().min(20)).max(60).optional(),
      postings: z
        .array(z.object({
          title: z.string().min(2),
          company: z.string().min(1),
          location: z.string().optional(),
          url: z.string().url().describe("The posting, preferably on the employer's own site"),
          description: z.string().min(80).describe("The full posting text, verbatim"),
          postedAt: z.string().optional().describe("YYYY-MM-DD if the page states it"),
        }))
        .max(60)
        .optional(),
    },
  },
  async ({ indeed_details, postings }) => {
    try {
      return json(addJobs({ indeedDetails: indeed_details, postings }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "search_career_sites",
  {
    title: "Search company career sites",
    description:
      "Call right after start_search (next says so). JevJob searches employers' own sites: for entry-level searches the community new-grad list (github.com/SimplifyJobs/New-Grad-Positions), and for every search the job boards of ~4,500 employers that hire tech roles (Greenhouse, Lever, Ashby, Workday, …), any level. Each posting is read from the employer's own system; direct apply links. Takes up to about a minute. Pass indeed_unavailable: true if you don't have the Indeed plugin or it's rate-limited.",
    inputSchema: {
      indeed_unavailable: z.boolean().optional().describe("true: no Indeed plugin (or it's rate-limited); skip its searches"),
    },
  },
  async ({ indeed_unavailable }) => {
    try {
      return json(await searchCareerSites({ indeedUnavailable: indeed_unavailable ?? false }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "more_jobs",
  {
    title: `${BATCH_SIZE} more postings, same search`,
    description: `Continue the current search for ${BATCH_SIZE} new postings (never repeating one). Then follow \`next\` exactly as for a new search.`,
  },
  async () => {
    try {
      return json(moreFromSearch());
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "open_app",
  { title: "Open the JevJob app", description: "Start the web app if needed and open it. An already-open app notices new postings and offers to rank them." },
  async () => json(await openApp()),
);

server.registerTool(
  "rank",
  {
    title: "Rank the pool against a resume",
    description: "Only when the user wants results in chat instead of the app: tiers and the top jobs with links, blockers and gaps.",
    inputSchema: {
      resume_text: z.string().optional(),
      resume_path: z.string().optional().describe("Path to a .md/.txt resume"),
      engine: z.enum(["auto", "jev", "rules"]).default("auto"),
      top: z.number().int().min(1).max(BATCH_SIZE).default(10),
      aggressiveness: z.number().min(0).max(1).default(0.5),
    },
  },
  async ({ resume_text, resume_path, engine, top, aggressiveness }) => {
    const text = resume_text ?? (resume_path ? readFileSync(resume_path, "utf8") : null);
    if (!text?.trim()) return fail("Pass resume_text or resume_path.");
    return json(await rankResume(text, { engine, top, aggressiveness }));
  },
);

server.registerTool(
  "clear_jobs",
  { title: "Clear loaded postings", description: "Forget the loaded postings and search; the app goes back to its fictional demo pool." },
  async () => {
    clearJobs();
    return json({ cleared: true });
  },
);

server.registerPrompt(
  "jevjob",
  {
    title: "Find and rank jobs with JevJob",
    description: "Plain-English job search, e.g. 'junior software engineer in Chicago this week', or 'more'.",
    argsSchema: { request: z.string().describe("What to look for, or 'more'") },
  },
  ({ request }) => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: /^\s*(more|next|next 50|50 more)\s*$/i.test(request)
          ? `Call JevJob more_jobs, then follow its \`next\` instructions until done. ${WORKFLOW}`
          : `Call JevJob start_search with request: ${JSON.stringify(request)}. Then follow its \`next\` instructions until done. ${WORKFLOW}`,
      },
    }],
  }),
);

await server.connect(new StdioServerTransport());
