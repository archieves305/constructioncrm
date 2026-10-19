import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";

/**
 * The permit assistant's only way onto the web. The model never fetches: it
 * picks numbered links, and this code decides and makes the request.
 *
 * Every connection is checked at connect time (the resolved address, so a
 * name that points inside the network is refused, and a DNS answer cannot
 * change between the check and the request): no private, loopback,
 * link-local, metadata or reserved address; http(s) on 80 / 443 only; three
 * redirects at most, each hop checked again; 15 seconds; 25 MB.
 */
export const USER_AGENT = "KNU-Construction-CRM/1.0 (permit document assistant; +https://crm.careyos.com)";
export const ROBOTS_AGENT = "knu-construction-crm";
export const FETCH_TIMEOUT_MS = 15_000;
export const FETCH_MAX_BYTES = 25 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

// ─── Addresses ──────────────────────────────────────────────────────────────

const V4_BLOCKED: [number, number][] = [
  [0x00000000, 8], // "this" network
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // 169.254/16 link-local, cloud metadata
  [0xac100000, 12], // 172.16/12
  [0xc0000000, 24], // 192.0.0/24
  [0xc0000200, 24], // 192.0.2/24 documentation
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15 benchmarking
  [0xc6336400, 24], // 198.51.100/24 documentation
  [0xcb007100, 24], // 203.0.113/24 documentation
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved + broadcast
];

function v4ToInt(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return ((Number(p[0]) << 24) >>> 0) + (Number(p[1]) << 16) + (Number(p[2]) << 8) + Number(p[3]);
}

/** Is this an address the assistant must never connect to? Unparseable counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip)!;
    return V4_BLOCKED.some(([base, bits]) => (n & (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0)) >>> 0 === base);
  }
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase();
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    if (a === "::" || a === "::1") return true;
    const first = parseInt(a.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (a.startsWith("64:ff9b:") || a.startsWith("2001:db8:") || a.startsWith("2001:db8::")) return true; // NAT64, documentation
    return false;
  }
  return true;
}

export class FetchRefused extends Error {}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

/** `lookup` for http(s).request: resolves, then refuses when any answer is a blocked address. */
export function safeLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs as dns.LookupAddress[];
    if (!list.length) return cb(Object.assign(new Error(`${hostname} has no address`), { code: "ENOTFOUND" }));
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad) return cb(Object.assign(new FetchRefused(`${hostname} points to a private or reserved address`), { code: "EBLOCKED" }));
    if (options?.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

// ─── Addresses that may be asked for ────────────────────────────────────────

/** Scheme and port before any network: http(s) on the standard ports, no credentials in the address. */
export function urlProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "not a web address";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `${u.protocol} addresses are not opened`;
  if (u.username || u.password) return "addresses with a user name or password are not opened";
  if (u.port && u.port !== "80" && u.port !== "443") return `port ${u.port} is not opened`;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedAddress(host)) return "a private or reserved address";
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) return "a local name";
  return null;
}

// ─── robots.txt ─────────────────────────────────────────────────────────────

/** Whether robots.txt lets `agent` open `path`: the group for the agent, else `*`; the longest matching rule wins. */
export function robotsAllows(robots: string, path: string, agent: string = ROBOTS_AGENT): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === "disallow" && val) cur.rules.push({ allow: false, path: val });
      if (key === "allow" && val) cur.rules.push({ allow: true, path: val });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  const matches = (rule: string) => {
    const re = new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
    return re.test(path);
  };
  const hit = rules.filter((r) => matches(r.path)).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))[0];
  return hit ? hit.allow : true;
}

// ─── The request ────────────────────────────────────────────────────────────

export type FetchResult =
  | { ok: true; finalUrl: string; status: number; contentType: string | null; body: Buffer }
  | { ok: false; refused: boolean; reason: string; finalUrl: string; status?: number };

type Hop = { status: number; headers: http.IncomingHttpHeaders; body: Buffer | null };

function requestOnce(url: string, maxBytes: number, deadline: number): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const left = Math.max(1, deadline - Date.now());
    const req = lib.request(
      u,
      { method: "GET", lookup: safeLookup as never, headers: { "user-agent": USER_AGENT, accept: "application/pdf,text/html;q=0.9,image/*;q=0.8,*/*;q=0.1", "accept-encoding": "gzip, deflate, br" }, timeout: left },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, headers: res.headers, body: null });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new FetchRefused(`larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new FetchRefused(`larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
          } else chunks.push(c);
        });
        res.on("end", () => {
          try {
            let body: Buffer = Buffer.concat(chunks);
            const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
            const opts = { maxOutputLength: maxBytes };
            if (enc === "gzip" || enc === "x-gzip") body = zlib.gunzipSync(body, opts);
            else if (enc === "deflate") body = zlib.inflateSync(body, opts);
            else if (enc === "br") body = zlib.brotliDecompressSync(body, opts);
            resolve({ status, headers: res.headers, body });
          } catch {
            reject(new FetchRefused(`could not be unpacked, or larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("took longer than 15 seconds")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * GET one address, following up to three redirects. `allowUrl` is asked about
 * the first address and every redirect target (the host policy); `urlProblem`
 * and the connect-time address check apply to every hop regardless.
 */
export async function safeFetch(url: string, opts: { allowUrl?: (url: string) => string | null; maxBytes?: number; timeoutMs?: number } = {}): Promise<FetchResult> {
  const deadline = Date.now() + (opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = urlProblem(current) ?? opts.allowUrl?.(current) ?? null;
    if (problem) return { ok: false, refused: true, reason: hop ? `redirected to ${current}: ${problem}` : problem, finalUrl: current };
    let res: Hop;
    try {
      res = await requestOnce(current, opts.maxBytes ?? FETCH_MAX_BYTES, deadline);
    } catch (err) {
      const refused = err instanceof FetchRefused || (err as NodeJS.ErrnoException)?.code === "EBLOCKED";
      return { ok: false, refused, reason: err instanceof Error ? err.message : String(err), finalUrl: current };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      try {
        current = new URL(String(res.headers.location), current).toString();
      } catch {
        return { ok: false, refused: false, reason: "a redirect to a bad address", finalUrl: current, status: res.status };
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) return { ok: false, refused: false, reason: `the site answered ${res.status}`, finalUrl: current, status: res.status };
    const contentType = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() || null;
    return { ok: true, finalUrl: current, status: res.status, contentType, body: res.body ?? Buffer.alloc(0) };
  }
  return { ok: false, refused: true, reason: `more than ${MAX_REDIRECTS} redirects`, finalUrl: current };
}

/** robots.txt for an origin, read once per run (a missing or unreadable file allows everything). */
export async function robotsFor(origin: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(origin)) return cache.get(origin)!;
  const r = await safeFetch(`${origin}/robots.txt`, { maxBytes: 512 * 1024, timeoutMs: 8_000 });
  const text = r.ok && (r.contentType ?? "text/plain").startsWith("text/") ? r.body.toString("utf8") : "";
  cache.set(origin, text);
  return text;
}

/** What a fetched body is, from its bytes first and its header second. Only PDFs, pages and pictures are read. */
export function fetchedKind(contentType: string | null, body: Buffer): "pdf" | "html" | "image" | null {
  const head = body.subarray(0, 1024).toString("latin1");
  if (head.includes("%PDF-")) return "pdf";
  const t = contentType ?? "";
  if (t === "image/png" || t === "image/jpeg" || t === "image/webp" || t === "image/gif") return "image";
  if (t === "text/html" || t === "application/xhtml+xml" || /^\s*(<!doctype html|<html)/i.test(head)) return "html";
  return null;
}
