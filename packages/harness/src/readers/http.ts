// Small fetch helpers shared by the readers.
import { plainText } from "../posting";

// A browser-like user agent: some career-site firewalls (iCIMS) refuse anything that names a bot.
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", Accept: "*/*" };
const TIMEOUT_MS = 12_000;

export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} for ${new URL(url).host}`);
  }
}

export async function get(url: string, as: "text"): Promise<string>;
export async function get<T = unknown>(url: string, as?: "json"): Promise<T>;
export async function get(url: string, as: "json" | "text" = "json"): Promise<unknown> {
  const once = () => fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  let res = await once();
  // Rate-limited: wait once, politely, instead of hammering the site or dropping the posting.
  if (res.status === 429) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 3, 10);
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await once();
  }
  if (!res.ok) throw new HttpError(res.status, url);
  return as === "text" ? res.text() : res.json();
}

export async function post<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

/** HTML (possibly entity-escaped) → plain text with list structure. */
export const text = (html: string | null | undefined): string => (html ? plainText(html) : "");

/** Epoch seconds or milliseconds, or an ISO-ish string → YYYY-MM-DD. */
export function isoDay(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    return new Date(n > 1e11 ? n : n * 1000).toISOString().slice(0, 10);
  }
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const parsed = Date.parse(`${String(value).replace(/\s+/g, " ")} UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : undefined;
}
