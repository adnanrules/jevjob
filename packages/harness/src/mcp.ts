// JevJob as an MCP server (stdio). Works in any harness that speaks MCP: Claude Desktop/Code, Codex, oh-my-pi…
// The harness LLM does what it's good at (finding postings, talking to you); JevJob does the repetitive
// per-requirement judging with Jev, so your chat model's usage isn't spent grading every bullet point.
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  clearJobs, currentJobs, importFromJoboid, jevAvailable, joboidDir, loadJobs, openApp, rankResume, APP_URL,
} from "./index";

const server = new McpServer(
  { name: "jevjob", version: "0.1.0" },
  {
    instructions: [
      "JevJob ranks job postings against a resume with one small typed classification per requirement.",
      "Typical flow: (1) get fresh postings, either import_from_joboid (company career sites, no LLM tokens) or",
      "load_jobs with postings you found yourself (full description + the employer's own apply link, replace=true",
      "for a new search). (2) open_app to show the user the animated ranking, or rank to get a compact summary",
      "in chat. Never claim a probability of being hired; tiers reflect requirement coverage.",
    ].join(" "),
  },
);

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

server.registerTool(
  "status",
  { title: "JevJob status", description: "Where the job pool comes from, how many postings it has, and whether Jev is configured." },
  async () => {
    const { source, jobs } = currentJobs();
    return json({ source, jobs: jobs.length, jev: jevAvailable(), joboid: Boolean(joboidDir()), app: APP_URL });
  },
);

server.registerTool(
  "load_jobs",
  {
    title: "Load job postings",
    description:
      "Give JevJob postings to rank. Each needs id, company, title, the full description text, and applyUrl (the employer's own site, not LinkedIn/Indeed). Joboid's `job` output is accepted as-is; closed postings are rejected.",
    inputSchema: {
      jobs: z.array(z.record(z.string(), z.unknown())).min(1).describe("Postings: {id, company, title, location, applyUrl, postedAt?, description}"),
      replace: z.boolean().default(true).describe("true: start a fresh pool (a new search). false: merge into the current pool."),
      max_age_days: z.number().int().positive().optional().describe("Optionally drop postings older than this"),
    },
  },
  async ({ jobs, replace, max_age_days }) => json(loadJobs(jobs, { replace, maxAgeDays: max_age_days })),
);

server.registerTool(
  "import_from_joboid",
  {
    title: "Import postings from Joboid",
    description: "Search Joboid (live postings from company career sites) and load the matches with full descriptions. Uses no LLM tokens.",
    inputSchema: {
      query: z.string().min(1).describe("Keywords, e.g. 'junior software engineer'"),
      location: z.string().optional(),
      remote: z.boolean().optional(),
      days: z.number().int().positive().optional().describe("Only postings from the last N days"),
      limit: z.number().int().min(1).max(60).default(20),
      keep: z.boolean().default(false).describe("Merge into the current pool instead of replacing it"),
    },
  },
  async (args) => json(await importFromJoboid(args)),
);

server.registerTool(
  "open_app",
  { title: "Open the JevJob app", description: "Start the JevJob web app if needed and open it in the user's browser, where they paste a resume and watch the ranking." },
  async () => json(await openApp()),
);

server.registerTool(
  "rank",
  {
    title: "Rank the pool against a resume",
    description: "Rank every loaded posting against a resume and return a compact summary: tier counts and the top jobs with apply links, blockers and gaps.",
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

await server.connect(new StdioServerTransport());
