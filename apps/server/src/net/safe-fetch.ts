import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch, type Response } from "undici";

/** Addresses that must never be reached from content-derived URLs (fetched pages, feeds, search results). */
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    if (mapped) return blocked.check(mapped, "ipv4");
  }
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** DNS lookup that refuses private/internal answers — enforced at connect time, so DNS rebinding can't slip past. */
const guardedLookup: typeof dnsLookup = ((hostname: string, options: object, callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const bad = addresses.find((a) => isBlockedAddress(a.address));
    if (bad) return callback(new Error(`Blocked address ${bad.address} for ${hostname}`), []);
    if ("all" in options && options.all) return callback(null, addresses);
    const first = addresses[0];
    if (!first) return callback(new Error(`No address for ${hostname}`), []);
    callback(null, first.address, first.family);
  });
}) as typeof dnsLookup;

const agent = new Agent({ connect: { lookup: guardedLookup, timeout: 10_000 } });

type SafeFetchOptions = { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> };
/** truncated: the body hit maxBytes and was cut short. */
type SafeResponse = { url: string; status: number; headers: Response["headers"]; body: string; truncated: boolean };

const MAX_REDIRECTS = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; DailyBrief/1.0; +self-hosted news reader)";

function assertFetchable(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Unsupported protocol ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) throw new Error(`Blocked address ${host}`);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error(`Blocked host ${host}`);
  }
  return url;
}

/** GET a public http(s) URL: private ranges blocked on every hop, redirects re-checked, body capped. */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  const maxBytes = opts.maxBytes ?? 3_000_000;
  let url = assertFetchable(rawUrl);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, {
      dispatcher: agent,
      redirect: "manual",
      signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", ...opts.headers },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
      url = assertFetchable(new URL(location, url).toString());
      continue;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (res.body) {
      // Leaving the loop releases and cancels the stream (cancel() inside it throws: the iterator holds the lock).
      for await (const chunk of res.body) {
        size += chunk.byteLength;
        if (size > maxBytes) {
          truncated = true;
          break;
        }
        chunks.push(chunk);
      }
    }
    return { url: url.toString(), status: res.status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated };
  }
}
