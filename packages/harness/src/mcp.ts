// JevJob as an MCP server (stdio). Works in any harness that speaks MCP: Claude Desktop/Code, Codex, oh-my-pi…
// The harness model does what it's good at: understanding the request and writing a search plan (titles employers
// use, a metro's suburbs, the level implied by "junior"). JevJob does the repetitive work: finding and checking
// postings, then judging every requirement with Jev. Your chat model never reads the postings.
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clearJobs, currentJobs, findJobs, jevAvailable, joboidDir, loadJobs, moreJobs, openApp, rankResume, APP_URL } from "./index";

const server = new McpServer(
  { name: "jevjob", version: "0.2.0" },
  {
    instructions: [
      "JevJob ranks job postings against a resume, one small typed classification per requirement.",
      "To search: turn the user's words into a plan and call find_jobs. Don't ask them for parameters; infer them.",
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
    return json({ source, jobs: jobs.length, jev: jevAvailable(), joboid: Boolean(joboidDir()), app: APP_URL });
  },
);

server.registerTool(
  "find_jobs",
  {
    title: "Find job postings",
    description: [
      "Find live postings on company career sites for a search plan you write from the user's request, and load them.",
      "Infer everything; don't ask. Titles: 4-12 titles employers actually use for the role (for 'junior software",
      "engineer': software engineer, software developer, associate software engineer, application developer, full stack",
      "engineer, backend engineer…). Level: entry for junior/new grad/entry level/associate, senior for senior/staff/lead,",
      "else any. Locations: for a city, include its metro's suburbs and nearby cities (Chicago → Evanston, Skokie,",
      "Schaumburg, Naperville, Oak Brook, Deerfield, Northbrook, Rosemont…); empty for anywhere. Remote: true if they want",
      "remote too. Posted: only if they gave a time window. Count: their number, else 50.",
      "A new search replaces the pool (keep=false); use keep=true to add a second plan (e.g. 'Chicago or remote in the",
      "midwest' is one plan for Chicago and one remote plan). When results are thin, JevJob discovers more companies.",
    ].join(" "),
    inputSchema: {
      titles: z.array(z.string().min(2)).min(1).max(20).describe("Job titles as employers write them"),
      level: z.enum(["entry", "mid", "senior", "any"]).default("any"),
      locations: z.array(z.string()).max(60).default([]).describe("Cities/areas incl. suburbs; empty = anywhere"),
      remote: z.boolean().default(false).describe("Also accept remote postings"),
      posted: z.enum(["24h", "7d", "30d", "3month"]).optional().describe("Only postings that went up within this window"),
      count: z.number().int().min(1).max(200).default(50),
      internships: z.boolean().default(false),
      keep: z.boolean().default(false).describe("Add to the current pool instead of starting a new search"),
    },
  },
  async ({ keep, ...plan }) => json(await findJobs(plan, { keep })),
);

server.registerTool(
  "more_jobs",
  {
    title: "More postings, same search",
    description: "Rerun the current search plans exactly, and replace the pool with postings the user hasn't seen yet. Reports `exhausted` when there are none left.",
  },
  async () => json(await moreJobs()),
);

server.registerTool(
  "load_jobs",
  {
    title: "Load postings you found yourself",
    description:
      "Only for postings from somewhere other than find_jobs (e.g. a link the user pasted). Each needs id, company, title, the full description, and applyUrl on the employer's own site. Closed postings are rejected.",
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

await server.connect(new StdioServerTransport());
