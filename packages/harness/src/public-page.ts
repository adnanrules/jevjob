// Anonymous public pages only. Pin DNS results to the checked public addresses on every redirect.
import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { isIP } from "node:net";

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31
      || a === 192 && (b === 168 || b === 0) || a === 100 && b! >= 64 && b! <= 127 || a! >= 224
      || a === 198 && (b === 18 || b === 19));
  }
  // Only global unicast IPv6; excludes loopback, mapped IPv4, link local, and unique local.
  return isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(?:db8|0):/i.test(address) && !/^2002:/i.test(address);
}

export function publicUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !url.hostname.includes(".") || /\.(?:local|localhost|internal|test|invalid)$/i.test(url.hostname)
    || (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !publicAddress(url.hostname.replace(/^\[|\]$/g, "")))) {
    throw new Error("Not a public HTTPS URL");
  }
  return url;
}

export async function fetchPublicPage(value: string, redirects = 0): Promise<string> {
  const url = publicUrl(value);
  if (redirects > 3) throw new Error("Too many redirects");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw new Error("Non-public address");
  return new Promise((resolve, reject) => {
    const req = get(url, {
      headers: { "User-Agent": "JevJob/0.2 (public job listing reader)", Accept: "text/html,application/xhtml+xml" },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      signal: AbortSignal.timeout(8000),
    }, (res) => {
      if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        resolve(fetchPublicPage(new URL(res.headers.location, url).href, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Page HTTP ${res.statusCode}`)); return; }
      if (!/html/i.test(res.headers["content-type"] ?? "")) { res.resume(); reject(new Error("Not HTML")); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2_000_000) { req.destroy(new Error("Page too large")); return; }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}
