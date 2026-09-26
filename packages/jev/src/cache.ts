// Content-addressed response cache: an identical request (model + state + questions) returns the saved answer.
// Changing a prompt changes the hash, so stale answers can never be served for a new question.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface Cache {
  get(request: unknown): Promise<unknown | undefined>;
  set(request: unknown, response: unknown): Promise<void>;
}

const keyOf = (request: unknown) => createHash("sha256").update(JSON.stringify(request)).digest("hex");

export function fileCache(dir: URL): Cache {
  const fileFor = (request: unknown) => new URL(`${keyOf(request)}.json`, dir);
  return {
    async get(request) {
      try {
        return JSON.parse(await readFile(fileFor(request), "utf8"));
      } catch {
        return undefined;
      }
    },
    async set(request, response) {
      await mkdir(dir, { recursive: true });
      await writeFile(fileFor(request), JSON.stringify(response));
    },
  };
}
