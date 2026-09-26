// JevJob as an MCP server (stdio). Works in any harness that speaks MCP: Claude Desktop/Code, Codex, oh-my-pi…
// The harness model does what it's good at: understanding the request and writing a search plan (titles employers
// use, a metro's suburbs, the level implied by "junior"). JevJob does the repetitive work: finding and checking
// postings, then judging every requirement with Jev. Your chat model never reads the postings.
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clearJobs, currentJobs, exaAvailable, findJobs, jevAvailable, joboidDir, loadJobs, moreJobs, openApp, rankResume, APP_URL } from "./index";
import { requestPlan, searchInput } from "./search-request";

const server = new McpServer(
  { name: "jevjob", version: "0.2.0" },
  {
    instructions: [
      "JevJob ranks job postings against a resume, one small typed classification per requirement.",
      "To search: call find_jobs with the user's query or a structured plan. Public Exa search is the default, not a saved company list.",
      "Locations widen progressively when results are thin. Report areasSearched and matchesByArea; strict mode keeps requested geography. US-wide expansion is remote only.",
      "Then call open_app. For 'more' / 'different jobs', call more_jobs. Never read or rank the postings yourself.",
      "Never claim a probability of being hired; tiers reflect requirement coverage.",
    ].join(" "),
  },
);

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

server.registerTool(
  "status",
  { title: "JevJob status", description: "Where the job pool comes from, how many postings it has, and whether Jev is configured." },
  async () => {
    const { source, jobs } = currentJobs();
    return json({ source, jobs: jobs.length, jev: jevAvailable(), exa: exaAvailable(), defaultSearchProvider: "exa", joboid: Boolean(joboidDir()), app: APP_URL });
  },
);

server.registerTool(
  "find_jobs",
  {
    title: "Find job postings",
    description: [
      "Search public job boards and employer listings via Exa, extract individual postings, and load matches.",
      "Pass query for a plain-language request or titles plus filters. Explicit filters override the query.",
      "Chicago expands to city, metro, Illinois, surrounding states, then US remote only, until count is reached.",
      "Use location_mode=strict for no widening. Date limits require the posting's own date, not an index timestamp.",
      "A successful new search replaces the pool; keep=true adds a plan. Empty/error searches preserve the existing pool.",
      "Report warnings and skipped reasons. Search is bounded; limited results do not prove no other jobs exist.",
    ].join(" "),
    inputSchema: searchInput,
  },
  async (input) => {
    try { return json(await findJobs(requestPlan(input), { keep: input.keep, provider: input.provider, maxQueries: input.max_queries })); }
    catch (err) { return { isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : "Search failed." }] }; }
  },
);

server.registerTool(
  "more_jobs",
  {
    title: "More postings, same search",
    description: "Continue saved filters with additional title/location queries; load unseen postings. An empty batch preserves the pool. Public-web search never claims global exhaustion.",
    inputSchema: { max_queries: z.number().int().min(1).max(6).default(5) },
  },
  async ({ max_queries }) => json(await moreJobs({ maxQueries: max_queries })),
);

server.registerTool(
  "load_jobs",
  {
    title: "Load postings you found yourself",
    description:
      "Only for postings from somewhere other than find_jobs. Each needs id, company, title, the full description, and applyUrl to a public job posting or employer application page. Closed postings are rejected.",
    inputSchema: {
      jobs: z.array(z.record(z.string(), z.unknown())).min(1),
      replace: z.boolean().default(true),
    },
  },
  async ({ jobs, replace }) => json(loadJobs(jobs, { replace })),
);

server.registerTool(
  "open_app",
  { title: "Open the JevJob app", description: "Start the JevJob web app if needed and open it in the user's browser. An already-open app notices a new pool and offers to re-rank." },
  async () => json(await openApp()),
);

server.registerTool(
  "rank",
  {
    title: "Rank the pool against a resume",
    description: "Only when the user wants results in chat instead of the app: a compact summary of tiers and the top jobs with apply links, blockers and gaps.",
    inputSchema: {
      resume_text: z.string().optional().describe("The resume as plain text or markdown"),
      resume_path: z.string().optional().describe("Or a path to a .md/.txt resume file"),
      engine: z.enum(["auto", "jev", "rules"]).default("auto"),
      top: z.number().int().min(1).max(50).default(10),
      aggressiveness: z.number().min(0).max(1).default(0.5).describe("0 conservative … 1 apply anyway"),
    },
  },
  async ({ resume_text, resume_path, engine, top, aggressiveness }) => {
    const text = resume_text ?? (resume_path ? readFileSync(resume_path, "utf8") : null);
    if (!text?.trim()) return { isError: true, content: [{ type: "text" as const, text: "Pass resume_text or resume_path." }] };
    return json(await rankResume(text, { engine, top, aggressiveness }));
  },
);

server.registerTool(
  "clear_jobs",
  { title: "Clear loaded postings", description: "Forget the loaded postings; the app goes back to its fictional demo pool." },
  async () => {
    clearJobs();
    return json({ cleared: true });
  },
);

server.registerPrompt("jevjob", {
  title: "Search jobs with JevJob",
  description: "Find public job listings from a title, place and optional time window.",
  argsSchema: { query: z.string().describe("Example: junior software engineer in Chicago, last 7 days") },
}, ({ query }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `Use JevJob find_jobs with this query: ${query}\nReport the areas searched, count loaded, and material warnings. Then open_app.` } }] }));

await server.connect(new StdioServerTransport());
