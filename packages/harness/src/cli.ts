// JevJob from a terminal. Indeed search runs through the chat app's Indeed plugin (see mcp.ts), which a terminal
// can't reach, so `find` here searches the companies Joboid tracks. Everything else matches the MCP server.
// Run: npm run jevjob -- <command>
import { readFileSync } from "node:fs";
import {
  clearJobs, currentJobs, findTrackedJobs, jevAvailable, loadJobs, moreTrackedJobs, openApp, planFromQuery, POSTED_WINDOWS,
  rankResume, searchStatus, type Engine, type PostedWindow,
} from "./index";

const HELP = `jevjob <command>

  find "<request>"        search the companies Joboid tracks, e.g. "junior software engineer in Chicago, last 7 days"
                          [--location L] [--remote] [--posted 24h|7d|30d|3month] [--count N] [--keep] [--strict-location]
                          (Indeed search runs from Claude or Codex: /jevjob <request>)
  more                    same tracked-company search, only postings you haven't seen yet
  load <file.json|->      load postings you found yourself [--keep]
  open                    start the app and open it in your browser
  rank <resume.md>        rank the pool in the terminal [--engine jev|rules] [--top N] [--json]
  status                  what's loaded and whether Jev is configured
  clear                   forget loaded postings (back to the demo pool)`;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_FLAGS = new Set(["location", "posted", "count", "limit", "engine", "top"]);
const BOOLEAN_FLAGS = new Set(["remote", "keep", "no-widen", "strict-location", "json", "help"]);
const positional: string[] = [];
function parseArgs() {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a.slice(2))) {
        if (!args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`${a} needs a value.`);
        i++;
      } else if (!BOOLEAN_FLAGS.has(a.slice(2))) throw new Error(`Unknown option: ${a}`);
    } else positional.push(a);
  }
}
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function main() {
  parseArgs();
  if (flag("help") || !args.length) return console.log(HELP);
  const known = new Set(["find", "search", "more", "load", "open", "rank", "status", "clear"]);
  const command = known.has(positional[0] ?? "") ? positional[0] : "find";
  const target = (known.has(positional[0] ?? "") ? positional.slice(1) : positional).join(" ");

  switch (command) {
    case "find":
    case "search": {
      if (!target) throw new Error('Usage: jevjob find "<request>"');
      const posted = option("posted");
      if (posted && !Object.hasOwn(POSTED_WINDOWS, posted)) throw new Error(`--posted must be one of: ${Object.keys(POSTED_WINDOWS).join(", ")}`);
      const count = option("count") ?? option("limit");
      const plan = planFromQuery(target, {
        location: option("location"),
        remote: flag("remote") ? true : undefined,
        posted: posted as PostedWindow | undefined,
        count: count !== undefined ? Number(count) : undefined,
        locationMode: flag("strict-location") || flag("no-widen") ? "strict" : "expand",
      });
      const result = await findTrackedJobs(plan, { keep: flag("keep"), widen: !flag("no-widen") });
      print({ plan: { ...plan, locations: plan.locations.length > 6 ? [...plan.locations.slice(0, 6), "…"] : plan.locations }, ...result });
      break;
    }
    case "more":
      print(await moreTrackedJobs());
      break;
    case "load": {
      if (!target) throw new Error("Usage: jevjob load <file.json|->");
      const text = target === "-" ? readFileSync(0, "utf8") : readFileSync(target, "utf8");
      print(loadJobs(JSON.parse(text), { replace: !flag("keep") }));
      break;
    }
    case "open":
      print(await openApp());
      break;
    case "rank": {
      if (!target) throw new Error("Usage: jevjob rank <resume.md>");
      const summary = await rankResume(readFileSync(target, "utf8"), {
        engine: (option("engine") as Engine | undefined) ?? "auto",
        top: Number(option("top") ?? 10),
      });
      if (flag("json")) print(summary);
      else {
        console.log(`${summary.jobs} jobs (${summary.source}) · ${summary.engine} · ${summary.jevCalls} Jev calls`);
        for (const j of summary.top) console.log(`#${j.rank} ${j.tier.padEnd(11)} ${j.title} · ${j.company}  ${j.required} required  ${j.apply}`);
      }
      break;
    }
    case "status": {
      const { source, jobs } = currentJobs();
      print({ source, jobs: jobs.length, jev: jevAvailable(), search: searchStatus() });
      break;
    }
    case "clear":
      clearJobs();
      print({ cleared: true });
      break;
    default:
      console.log(HELP);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
