// The same operations as the MCP server, for shells and harnesses without MCP.
// Run: npm run jevjob -- <command>
import { readFileSync } from "node:fs";
import { clearJobs, currentJobs, importFromJoboid, jevAvailable, loadJobs, openApp, rankResume, type Engine } from "./index";

const HELP = `jevjob <command>

  joboid "<query>" [--location L] [--remote] [--days N] [--limit N] [--keep]
                          pull fresh postings from Joboid (replaces the pool unless --keep)
  load <file.json|->      load postings you found yourself [--keep] [--max-age N]
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
const VALUE_FLAGS = new Set(["location", "days", "limit", "max-age", "engine", "top"]);
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a.startsWith("--")) {
    if (VALUE_FLAGS.has(a.slice(2))) i++; // skip the flag's value
  } else positional.push(a);
}
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function main() {
  const [command, target] = positional;
  switch (command) {
    case "joboid": {
      if (!target) throw new Error('Usage: jevjob joboid "<query>"');
      const days = option("days");
      print(await importFromJoboid({
        query: target,
        ...(option("location") && { location: option("location")! }),
        remote: flag("remote"),
        ...(days && { days: Number(days) }),
        limit: Number(option("limit") ?? 20),
        keep: flag("keep"),
      }));
      break;
    }
    case "load": {
      if (!target) throw new Error("Usage: jevjob load <file.json|->");
      const text = target === "-" ? readFileSync(0, "utf8") : readFileSync(target, "utf8");
      const maxAge = option("max-age");
      print(loadJobs(JSON.parse(text), { replace: !flag("keep"), maxAgeDays: maxAge ? Number(maxAge) : undefined }));
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
      print({ source, jobs: jobs.length, jev: jevAvailable() });
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
