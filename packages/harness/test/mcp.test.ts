// End-to-end over the real protocol: spawn the server on stdio, connect the official MCP client, call tools.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const client = new Client({ name: "jevjob-test", version: "0.0.0" });

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), path.join(ROOT, "packages/harness/src/mcp.ts")],
      cwd: ROOT,
    }),
  );
}, 30_000);

afterAll(() => client.close());

describe("jevjob MCP server", () => {
  it("exposes the harness tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["clear_jobs", "find_jobs", "load_jobs", "more_jobs", "open_app", "rank", "status"]);
  });

  it("answers status as JSON", async () => {
    const result = await client.callTool({ name: "status", arguments: {} });
    const [first] = result.content as Array<{ type: string; text: string }>;
    const status = JSON.parse(first!.text) as { source: string; jobs: number; app: string };
    expect(["harness", "demo"]).toContain(status.source);
    expect(status.app).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it("rejects a rank call with no resume instead of guessing", async () => {
    const result = await client.callTool({ name: "rank", arguments: {} });
    expect(result.isError).toBe(true);
  });
});
