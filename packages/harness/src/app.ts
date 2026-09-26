// Starts the web app if it isn't running, then opens it in the default browser.
import { spawn } from "node:child_process";
import { ROOT } from "./paths";

export const APP_PORT = Number(process.env.JEVJOB_PORT ?? 3100);
export const APP_URL = `http://localhost:${APP_PORT}`;

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${APP_URL}/api/setup`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function openApp({ browser = true }: { browser?: boolean } = {}): Promise<{ url: string; started: boolean }> {
  let started = false;
  if (!(await isUp())) {
    // Detached so the app outlives the CLI or MCP call that started it.
    spawn("npm", ["run", "web"], { cwd: ROOT, detached: true, stdio: "ignore", shell: process.platform === "win32", windowsHide: true }).unref();
    started = true;
    const deadline = Date.now() + 90_000;
    while (!(await isUp())) {
      if (Date.now() > deadline) throw new Error(`The app didn't start on ${APP_URL} within 90s. Try \`npm run web\` to see why.`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (browser) {
    const [cmd, args] =
      process.platform === "win32" ? ["cmd", ["/c", "start", "", APP_URL]]
      : process.platform === "darwin" ? ["open", [APP_URL]]
      : ["xdg-open", [APP_URL]];
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
  return { url: APP_URL, started };
}
