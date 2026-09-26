// Server-only helpers. Job pool and assessor selection live in @jevjob/harness, shared with the CLI and MCP server.
import { readFileSync } from "node:fs";
import path from "node:path";
import { currentJobs, getAssessor, jevAvailable, ROOT } from "@jevjob/harness";

export { currentJobs as loadJobs, getAssessor, jevAvailable };
export type AssessorName = "rules" | "jev";
export const jevModel = () => process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest";

export interface Sample {
  key: string;
  name: string;
  headline: string;
  text: string;
}

/** The fictional candidates from the eval set, offered as one-click demo resumes. */
export function loadSamples(): Sample[] {
  const files: Array<[string, string, string]> = [
    ["jordan", "fixtures/resume.jordan-rivera.md", "New grad, CS"],
    ["priya", "packages/eval/dataset/resumes/priya-shah.md", "Bootcamp → frontend"],
    ["marcus", "packages/eval/dataset/resumes/marcus-bell.md", "Backend, 5 yrs"],
    ["elena", "packages/eval/dataset/resumes/elena-novak.md", "Data scientist, M.S."],
    ["sam", "packages/eval/dataset/heldout/resumes/sam-okafor.md", "IT support, 4 yrs"],
    ["grace", "packages/eval/dataset/heldout/resumes/grace-liu.md", "New grad, NLP"],
    ["devon", "packages/eval/dataset/heldout/resumes/devon-park.md", "Senior data eng"],
  ];
  return files.map(([key, file, headline]) => {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const name = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? key;
    return { key, name, headline, text };
  });
}
