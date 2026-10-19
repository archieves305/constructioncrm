import { htmlToText } from "@/lib/partners/itb-parse";

/**
 * The links in a document or a web page, without the network. Pure.
 *
 * A link is numbered the way the AI sees it; the AI answers with numbers,
 * never with addresses, so it cannot make up a URL for the fetcher.
 */
export type FoundLink = { id: number; url: string; text: string | null; page: number | null };

/** Links read per document or page; a department page lists a hundred forms, a page of several hundred is a site map. */
export const MAX_LINKS = 150;

/** An absolute http(s) address, or null. A `www.` address printed without a scheme is read as https. */
export function normalizeUrl(raw: string, base?: string): string | null {
  let s = raw.trim().replace(/&amp;/g, "&");
  if (!s || s.startsWith("#") || /^(mailto|tel|javascript|data|ftp|file):/i.test(s)) return null;
  if (/^www\./i.test(s)) s = `https://${s}`;
  try {
    const u = base ? new URL(s, base) : new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Addresses printed in text: "https://…", "http://…" and "www.…". Trailing punctuation is not part of a link. */
export function urlsInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'()[\]{}]+/gi)) {
    const u = normalizeUrl(m[0].replace(/[.,;:!?]+$/, ""));
    if (u) out.push(u);
  }
  return out;
}

/** A PDF's links: its link annotations (with their page) and the addresses printed in its text. */
export function pdfLinks(annotations: readonly { page: number; url: string }[], pages: readonly string[]): FoundLink[] {
  const seen = new Map<string, FoundLink>();
  const add = (url: string | null, page: number | null) => {
    if (!url || seen.has(url) || seen.size >= MAX_LINKS) return;
    seen.set(url, { id: seen.size + 1, url, text: null, page });
  };
  for (const a of annotations) add(normalizeUrl(a.url), a.page);
  pages.forEach((p, i) => urlsInText(p).forEach((u) => add(u, i + 1)));
  return [...seen.values()];
}

/** A web page's visible text and its links, each with the words it is anchored on. */
export function htmlPage(html: string, baseUrl: string): { title: string | null; text: string; links: FoundLink[] } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const seen = new Map<string, FoundLink>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = normalizeUrl(m[1] ?? m[2] ?? m[3] ?? "", baseUrl);
    if (!url || url === baseUrl || seen.has(url) || seen.size >= MAX_LINKS) continue;
    const text = htmlToText(m[4]).replace(/\s+/g, " ").trim().slice(0, 160) || null;
    seen.set(url, { id: seen.size + 1, url, text, page: null });
  }
  return { title: title ? htmlToText(title).replace(/\s+/g, " ").trim().slice(0, 200) : null, text: htmlToText(html), links: [...seen.values()] };
}

/** The host a rule speaks about: lower case, no `www.`. */
export const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** `host` is `site` or one of its subdomains. */
export function hostWithin(host: string, site: string): boolean {
  const h = bareHost(host);
  const s = bareHost(site);
  return h === s || h.endsWith(`.${s}`);
}

/** The state and county product-approval sites: always allowed to open. */
export const APPROVAL_HOSTS = ["floridabuilding.org", "miamidade.gov"] as const;

export type FollowContext = {
  source: "UPLOAD" | "LINK" | "SITE";
  depth: number;
  /** The jurisdiction's website host and its allowed sites. */
  siteHosts: readonly string[];
};

/** How deep the assistant goes from where it started. */
export const MAX_DEPTH = 2;

/**
 * May a link found in this item be opened? From a person's document: any
 * public site, one hop (the document named it). From anything fetched: only the
 * building department's sites and the approval sites, and never past depth 2.
 */
export function mayFollow(from: FollowContext, url: string): { ok: true } | { ok: false; reason: string } {
  if (from.depth + 1 > MAX_DEPTH) return { ok: false, reason: "too far from the documents it started with" };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, reason: "not a web address" };
  }
  if (from.source === "UPLOAD") return { ok: true };
  const allowed = [...from.siteHosts, ...APPROVAL_HOSTS];
  return allowed.some((s) => hostWithin(host, s)) ? { ok: true } : { ok: false, reason: `${bareHost(host)} is not the building department's site or an approval site` };
}

/** A jurisdiction's hosts from its website and the allowed sites typed in. */
export function siteHostsOf(j: { websiteUrl: string | null; allowedHosts: readonly string[] | null } | null): string[] {
  if (!j) return [];
  const out = new Set<string>();
  if (j.websiteUrl) {
    try {
      out.add(bareHost(new URL(j.websiteUrl).hostname));
    } catch {
      /* a bad address simply adds nothing */
    }
  }
  for (const h of j.allowedHosts ?? []) if (h.trim()) out.add(bareHost(h.trim()));
  return [...out];
}
