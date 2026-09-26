// npm run setup: the one-time setup for a fresh clone.
//   1. Checks Node, creates .env from .env.example, and says whether a Jev key is set (never prints it).
//   2. Prints the exact MCP config for Claude Code, Claude Desktop and Codex, with this folder's absolute paths.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const slash = (p: string) => p.replace(/\\/g, "/"); // forward slashes work everywhere, and need no escaping in JSON/TOML
const tsx = slash(path.join(root, "node_modules/tsx/dist/cli.mjs"));
const server = slash(path.join(root, "packages/harness/src/mcp.ts"));
const ok = (s: string) => console.log(`  ✓ ${s}`);
const todo = (s: string) => console.log(`  • ${s}`);

console.log("\nJevJob setup\n");

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.log(`  ✗ Node ${process.versions.node} is too old. Install Node 20 or newer, then run npm install and npm run setup again.`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);
if (!existsSync(tsx)) {
  console.log("  ✗ Dependencies are missing. Run npm install first.");
  process.exit(1);
}
ok("dependencies installed");

const env = path.join(root, ".env");
if (!existsSync(env)) {
  copyFileSync(path.join(root, ".env.example"), env);
  ok("created .env from .env.example");
}
const key = /^\s*TYPESAFE_API_KEY\s*=\s*\S+/m.test(readFileSync(env, "utf8"));
if (key) ok("Jev key found in .env");
else todo("No Jev key yet. Put your TypeSafe AI (or OpenRouter) key in .env as TYPESAFE_API_KEY. Until then, JevJob ranks with its rules engine.");

const desktopConfig =
  process.platform === "win32" ? "%APPDATA%\\Claude\\claude_desktop_config.json"
  : process.platform === "darwin" ? "~/Library/Application Support/Claude/claude_desktop_config.json"
  : "~/.config/Claude/claude_desktop_config.json";

console.log(`
Connect it to your assistant (pick one or more):

  Claude Code
    In this folder it's already set up (.mcp.json). Start Claude Code here and approve the "jevjob" server.
    To use it from any folder:
      claude mcp add --scope user jevjob -- node "${tsx}" "${server}"
    The /jevjob command: copy .claude/commands/jevjob.md to ${slash(path.join(os.homedir(), ".claude/commands"))}/

  Claude Desktop
    Add this under "mcpServers" in ${desktopConfig}, then restart Claude Desktop:
      "jevjob": { "command": "node", "args": ["${tsx}", "${server}"] }

  Codex
    Add this to ~/.codex/config.toml, then restart Codex:
      [mcp_servers.jevjob]
      command = "node"
      args = ["${tsx}", "${server}"]

Then enable the Indeed plugin in the same app (optional; JevJob also reads employers' career sites on its own),
and ask: /jevjob junior software engineer in Chicago, last 30 days
`);
