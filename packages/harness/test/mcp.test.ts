// End-to-end over the real protocol: spawn the server on stdio, connect the official MCP client, call tools.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const client = new Client({ name: "jevjob-test", version: "0.0.0" });
const text = (result: Record<string, unknown>) => (result.content as Array<{ text: string }>)[0]!.text;

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), path.join(ROOT, "packages/harness/src/mcp.ts")],
      cwd: ROOT,
      // A scratch data folder, so the test never touches the real job pool.
      env: { ...(process.env as Record<string, string>), JEVJOB_DATA_DIR: mkdtempSync(path.join(tmpdir(), "jevjob-mcp-")) },
    }),
  );
}, 30_000);

afterAll(() => client.close());

describe("jevjob MCP server", () => {
  it("exposes the Indeed-first workflow", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["add_jobs", "add_search_results", "clear_jobs", "more_jobs", "open_app", "rank", "search_career_sites", "start_search", "status"],
    );
  });

  it("answers status as JSON", async () => {
    const status = JSON.parse(text(await client.callTool({ name: "status", arguments: {} }))) as { source: string; app: string };
    expect(["harness", "demo"]).toContain(status.source);
    expect(status.app).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it("rejects calls that are missing what they need instead of guessing", async () => {
    expect((await client.callTool({ name: "rank", arguments: {} })).isError).toBe(true);
    expect((await client.callTool({ name: "start_search", arguments: {} })).isError).toBe(true);
    expect((await client.callTool({ name: "add_search_results", arguments: { result: "no search started yet" } })).isError).toBe(true);
  });

  it("plans a search from plain words and sends the assistant to employers' career sites first", async () => {
    const brief = JSON.parse(text(await client.callTool({ name: "start_search", arguments: { request: "junior software engineer in Chicago, last 7 days" } }))) as {
      level: string; postedWithinDays: number; areas: Array<{ query: string }>; next: string; target: number;
    };
    expect(brief).toMatchObject({ level: "entry", postedWithinDays: 7, target: 50 });
    expect(brief.areas[0]!.query).toBe("Chicago, IL");
    expect(brief.next).toContain("search_career_sites");
  });

  it("exposes a reusable /jevjob prompt, including 'more'", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("jevjob");
    const search = await client.getPrompt({ name: "jevjob", arguments: { request: "junior software engineer in Chicago" } });
    expect(search.messages[0]?.content).toMatchObject({ type: "text", text: expect.stringContaining("start_search") });
    const more = await client.getPrompt({ name: "jevjob", arguments: { request: "more" } });
    expect(more.messages[0]?.content).toMatchObject({ type: "text", text: expect.stringContaining("more_jobs") });
  });
});
