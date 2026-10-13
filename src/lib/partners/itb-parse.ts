import { TZDate } from "@date-fns/tz";
import type { BidPlatform } from "@/generated/prisma/enums";
import { APP_TIME_ZONE } from "@/lib/time/zone";

/**
 * Reading a bid invitation (ITB) out of an email: which platform sent it, the
 * project, the GC, the due date, the site and the link back. Pure and
 * deterministic — no AI, no network. What it cannot read it leaves null, and
 * a person confirms every field before a bid exists.
 *
 * Forwarded mail is unwrapped first: the CRM sees the person who forwarded it,
 * the invitation's own sender is inside the body.
 */

export const PLATFORM_DOMAINS: Record<Exclude<BidPlatform, "EMAIL" | "OTHER">, string[]> = {
  BUILDINGCONNECTED: ["buildingconnected.com"],
  PROCORE: ["procore.com", "procoretech.com"],
  PLANHUB: ["planhub.com"],
  SMARTBID: ["smartbidnet.com", "smartbid.co"],
  CONSTRUCTCONNECT: ["constructconnect.com", "isqft.com", "bidclerk.com"],
  TEXTURA: ["texturacorp.com", "textura.com"],
};
const ALL_PLATFORM_DOMAINS = Object.values(PLATFORM_DOMAINS).flat();

/** Mailbox providers: a domain here says nothing about which company wrote. */
export const FREE_MAIL_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "me.com", "live.com", "msn.com", "comcast.net", "bellsouth.net", "att.net"];

export type ParsedDate = { at: string; dateOnly: boolean; text: string };
export type ParsedAddress = { address1: string | null; city: string | null; state: string | null; zipCode: string | null; text: string };
export type ItbKind = "INVITATION" | "ADDENDUM" | "UPDATE";

export type ParsedItb = {
  kind: ItbKind;
  platform: BidPlatform;
  platformUrl: string | null;
  platformRef: string | null;
  projectName: string | null;
  gcName: string | null;
  bidDue: ParsedDate | null;
  siteWalk: ParsedDate | null;
  preBidMeeting: ParsedDate | null;
  rfiDue: ParsedDate | null;
  address: ParsedAddress | null;
  scope: string | null;
  originalFrom: { name: string | null; email: string | null };
  originalSubject: string;
  contactEmail: string | null;
  contactName: string | null;
  contactPhone: string | null;
  /** The fields the reader found, for the review card ("read: project, due date …"). */
  found: string[];
};

export type EmailIn = { from: string; fromName?: string | null; subject: string; text?: string | null; html?: string | null; receivedAt: Date };

// ─── Text ───────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith("#") && k !== "#39") return String.fromCodePoint(Number(k.slice(1)));
      return ENTITIES[k] ?? m;
    })
    .replace(/[ \t ]+/g, (s) => (s.includes("\t") ? "\t" : " "))
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function linksIn(text: string, html: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (html ?? "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) out.push(m[1].replace(/&amp;/g, "&"));
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) out.push(m[0].replace(/[.,;]+$/, ""));
  return [...new Set(out.filter((u) => /^https?:\/\//i.test(u)))];
}

export function emailOf(s: string | null | undefined): string | null {
  const m = (s ?? "").match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

export function domainOf(email: string | null | undefined): string | null {
  const e = emailOf(email);
  return e ? e.split("@")[1] : null;
}

/** `sub.example.com` belongs to `example.com`. */
export function domainMatches(domain: string | null | undefined, list: readonly string[]): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return list.some((x) => d === x || d.endsWith(`.${x}`));
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ─── Forwarded mail ─────────────────────────────────────────────────────────

export type Unwrapped = { forwarded: boolean; from: string | null; subject: string | null; body: string };

const HEADER = /^\s*[>*]*\s*(from|sent|date|to|cc|subject)\s*:\s*\**\s*(.*)$/i;

/**
 * The innermost forwarded message: Gmail's "---------- Forwarded message",
 * Outlook's "From: / Sent: / To: / Subject:" block, Apple's "Begin forwarded
 * message:". A paste that starts with its own From / Subject lines reads the
 * same way.
 */
export function unwrapForward(text: string): Unwrapped {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADER);
    if (!m || m[1].toLowerCase() !== "from") continue;
    // A header block: a Subject line within the next six lines.
    const window = lines.slice(i + 1, i + 7);
    if (window.some((l) => /^\s*[>*]*\s*subject\s*:/i.test(l))) start = i; // keep the last (innermost) block
  }
  if (start < 0) return { forwarded: false, from: null, subject: null, body: text };
  let from: string | null = null;
  let subject: string | null = null;
  let i = start;
  for (; i < lines.length; i++) {
    const m = lines[i].match(HEADER);
    if (!m) break;
    const key = m[1].toLowerCase();
    if (key === "from") from = m[2].trim();
    if (key === "subject") subject = m[2].trim();
  }
  return { forwarded: true, from, subject, body: lines.slice(i).join("\n").trim() };
}

export function stripSubjectPrefixes(s: string): string {
  let out = s.trim();
  for (let n = 0; n < 5; n++) {
    const next = out.replace(/^\s*(?:re|fw|fwd|aw|wg)\s*:\s*/i, "").replace(/^\[(?:external|ext)\]\s*/i, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

// ─── Labels ─────────────────────────────────────────────────────────────────

const LABELS = {
  project: ["project name", "project title", "project", "job name", "opportunity"],
  due: ["bid due date", "bid due date/time", "bids due", "bid due", "bid date", "proposal due date", "proposals due", "proposal due", "due date", "due date/time", "bid deadline", "due"],
  siteWalk: ["site walk", "job walk", "site visit", "walkthrough", "walk-through", "job walkthrough"],
  preBid: ["pre-bid meeting", "pre bid meeting", "prebid meeting", "pre-bid", "prebid"],
  rfi: ["rfi due date", "rfi due", "rfi deadline", "rfis due", "questions due", "last day for questions", "deadline for questions"],
  address: ["project address", "project location", "site address", "job address", "address", "location"],
  gc: ["general contractor", "gc", "invited by", "company", "client"],
  scope: ["bid package", "bid packages", "scope of work", "scope", "trades", "trade", "package", "csi division", "division"],
  contact: ["bid contact", "estimator", "contact name", "contact", "point of contact"],
} as const;

/** "Label: value" or "Label<TAB>value" on one line (value on the next line when the line ends at the label). */
function labelled(lines: string[], names: readonly string[]): string | null {
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\/-]/g, (c) => `\\${c}`);
    const re = new RegExp(`^\\s*\\**\\s*${esc}\\s*\\**\\s*(?::|\\t|\\s[-–—]\\s)\\s*(.*)$`, "i");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) continue;
      const v = m[1].replace(/\*+/g, "").trim();
      if (v) return v;
      const next = lines[i + 1]?.trim();
      if (next && !/:\s*$/.test(next)) return next;
    }
  }
  return null;
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ZONE_OFFSETS: Record<string, number> = { EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, UTC: 0, GMT: 0 };

/**
 * A date as the invitation wrote it. "Tuesday, October 28, 2026 at 2:00 PM
 * EDT", "10/28/2026 2pm", "2026-10-28 14:00", "Oct 28" (the next one after
 * the email arrived). A named zone is honoured; anything else is office time
 * (America/New_York). No time → 5:00 PM office time, flagged `dateOnly`.
 */
export function parseItbDate(raw: string | null | undefined, receivedAt: Date, tz: string = APP_TIME_ZONE): ParsedDate | null {
  if (!raw) return null;
  const text = raw.trim().slice(0, 120);
  const s = text.replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/\s+/g, " ");
  let y: number | null = null;
  let mo: number | null = null;
  let d: number | null = null;
  let rest = s;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  } else if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    [mo, d] = [Number(m[1]) - 1, Number(m[2])];
    y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
  } else if ((m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i))) {
    [mo, d] = [MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), Number(m[2])];
    y = m[3] ? Number(m[3]) : null;
  } else if ((m = s.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?\b/i))) {
    [d, mo] = [Number(m[1]), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())];
    y = m[3] ? Number(m[3]) : null;
  } else return null;
  if (m.index !== undefined) rest = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;

  let hour: number | null = null;
  let minute = 0;
  const t12 = rest.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i);
  const t24 = rest.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (t12) {
    hour = Number(t12[1]) % 12 + (/^p/i.test(t12[3]) ? 12 : 0);
    minute = t12[2] ? Number(t12[2]) : 0;
  } else if (t24) {
    hour = Number(t24[1]);
    minute = Number(t24[2]);
  } else if (/\bnoon\b/i.test(rest)) hour = 12;
  if (hour !== null && (hour > 23 || minute > 59)) return null;

  const local = new TZDate(receivedAt.getTime(), tz);
  if (y === null) {
    y = local.getFullYear();
    // A date without a year is the next one on or after the day the email arrived.
    const candidate = new Date(Date.UTC(y, mo, d));
    const received = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
    if (candidate < received) y += 1;
  }
  const dateOnly = hour === null;
  const h = hour ?? 17;
  const zone = rest.match(/\b(EST|EDT|CST|CDT|MST|MDT|PST|PDT|UTC|GMT)\b/i)?.[1].toUpperCase();
  const at = zone && !dateOnly ? new Date(Date.UTC(y, mo, d, h - ZONE_OFFSETS[zone], minute)) : new Date(new TZDate(y, mo, d, h, minute, 0, 0, tz).getTime());
  // Reject roll-overs such as February 31.
  const check = new TZDate(at.getTime(), zone && !dateOnly ? "UTC" : tz);
  if (!(zone && !dateOnly) && (check.getMonth() !== mo || check.getDate() !== d)) return null;
  if (Number.isNaN(at.getTime())) return null;
  return { at: at.toISOString(), dateOnly, text };
}

// ─── Address ────────────────────────────────────────────────────────────────

export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  if (!raw) return null;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 300);
  const full = text.match(/^(.+?),\s*([^,]+?),\s*([A-Z]{2})\.?\s+(\d{5})(?:-\d{4})?\b/i);
  if (full) return { address1: full[1].trim(), city: full[2].trim(), state: full[3].toUpperCase(), zipCode: full[4], text };
  const cityState = text.match(/^(?:(.+?),\s*)?([^,]+?),\s*([A-Z]{2})\b\.?(?:\s+(\d{5}))?/i);
  if (cityState && /^[A-Z]{2}$/i.test(cityState[3])) {
    const first = cityState[1]?.trim() ?? null;
    return { address1: first && /\d/.test(first) ? first : null, city: cityState[2].trim(), state: cityState[3].toUpperCase(), zipCode: cityState[4] ?? null, text };
  }
  const zip = text.match(/\b(\d{5})\b/);
  return { address1: /^\d+\s+\S/.test(text) ? text.split(",")[0].trim() : null, city: null, state: null, zipCode: zip?.[1] ?? null, text };
}

// ─── Platform ───────────────────────────────────────────────────────────────

export function platformOfDomain(domain: string | null | undefined): BidPlatform | null {
  for (const [p, list] of Object.entries(PLATFORM_DOMAINS)) if (domainMatches(domain, list)) return p as BidPlatform;
  return null;
}

export function isPlatformDomain(domain: string | null | undefined): boolean {
  return domainMatches(domain, ALL_PLATFORM_DOMAINS);
}

function platformRefOf(platform: BidPlatform, url: string): string | null {
  const patterns: Partial<Record<BidPlatform, RegExp[]>> = {
    BUILDINGCONNECTED: [/\/(?:opportunities|projects|bid-packages)\/([a-f0-9]{24})/i],
    PROCORE: [/\/bid_packages\/(\d+)/i, /\/bids\/(\d+)/i, /\/projects\/(\d+)/i],
    PLANHUB: [/\/projects?\/([a-z0-9-]{6,})/i],
    SMARTBID: [/[?&](?:projectid|pid|bid)=(\d+)/i, /\/projects?\/(\d+)/i],
    CONSTRUCTCONNECT: [/\/projects?\/([a-z0-9-]{6,})/i],
  };
  for (const re of patterns[platform] ?? []) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

const NOT_THE_INVITATION = /unsubscribe|preferences|privacy|terms|help|support|login\/?$|signin\/?$|password|app-store|play\.google|apple\.com|facebook|linkedin|twitter|instagram/i;

function platformLink(platform: BidPlatform, links: string[]): { url: string | null; ref: string | null } {
  const domains = PLATFORM_DOMAINS[platform as keyof typeof PLATFORM_DOMAINS] ?? [];
  const onPlatform = links.filter((u) => domainMatches(hostOf(u), domains) && !NOT_THE_INVITATION.test(u));
  const withRef = onPlatform.find((u) => platformRefOf(platform, u));
  const preferred = withRef ?? onPlatform.find((u) => /opportunit|bid|project|invit/i.test(u)) ?? onPlatform[0] ?? null;
  return { url: preferred ? preferred.slice(0, 500) : null, ref: preferred ? platformRefOf(platform, preferred) : null };
}

// ─── The reader ─────────────────────────────────────────────────────────────

const INVITED = /(?:^|\n)\s*([^\n]{2,80}?)\s+(?:has\s+)?invited\s+(?:you|your company|knu[^\n]{0,30}?)\s+to\s+(?:bid|submit a (?:bid|proposal))\s+(?:on|for)\s+(?:the\s+)?([^\n]{3,160}?)(?:[.!]\s|[.!]?\s*$|\n)/i;
const SUBJECT_PROJECT = [
  /(?:invitation|invite)\s+to\s+bid\s*(?:[:\-–—|]|on|for)\s*(.+)$/i,
  /\bbid\s+invitation\s*(?:[:\-–—|]|for)\s*(.+)$/i,
  /^(?:itb|rfp|rfq|request for (?:proposal|quote|bid)s?)\s*(?:[:\-–—|#]\s*)(.+)$/i,
  /\binvited\s+to\s+bid\s+on\s+(.+)$/i,
  /^addend(?:um|a)\s*(?:#?\s*\d+)?\s*(?:[:\-–—|]|for|to)\s*(.+)$/i,
  /\b(?:bid date (?:change|extension|reminder)|bid reminder|reminder)\s*[:\-–—|]\s*(.+)$/i,
];

function clip(s: string | null | undefined, n: number): string | null {
  const v = s?.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, n) : null;
}

function nameOf(fromHeader: string | null | undefined): string | null {
  if (!fromHeader) return null;
  const n = fromHeader.replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  return n && !n.includes("@") ? n : null;
}

/** "Kaufman Lynn via BuildingConnected" → "Kaufman Lynn". */
function gcFromDisplayName(name: string | null): string | null {
  const m = name?.match(/^(.+?)\s+(?:via|through|on behalf of|\|)\s+/i);
  return m ? m[1].trim() : null;
}

export function parseItbEmail(email: EmailIn, opts: { ownDomains?: readonly string[] } = {}): ParsedItb {
  const rawText = email.text?.trim() ? email.text : htmlToText(email.html ?? "");
  const plain = /<\/?(?:p|div|br|table|td|span|a)\b/i.test(rawText) ? htmlToText(rawText) : rawText;
  const un = unwrapForward(plain.replace(/\r\n?/g, "\n"));
  const outerFrom = emailOf(email.from);
  const originalFromEmail = un.forwarded ? emailOf(un.from) : outerFrom;
  const originalFromName = un.forwarded ? nameOf(un.from) : (email.fromName?.trim() || nameOf(email.from));
  const originalSubject = stripSubjectPrefixes(un.subject ?? email.subject ?? "");
  const body = un.body;
  const lines = body.split("\n").map((l) => l.replace(/ /g, " "));
  const links = linksIn(body, email.html);
  const found: string[] = [];

  // Platform: the original sender's domain, else the links in the body.
  let platform: BidPlatform = platformOfDomain(domainOf(originalFromEmail)) ?? platformOfDomain(domainOf(outerFrom)) ?? "EMAIL";
  if (platform === "EMAIL") {
    for (const u of links) {
      const p = platformOfDomain(hostOf(u));
      if (p && !NOT_THE_INVITATION.test(u)) {
        platform = p;
        break;
      }
    }
  }
  if (platform !== "EMAIL") found.push("platform");
  const link = platform === "EMAIL" ? { url: null, ref: null } : platformLink(platform, links);
  if (link.url) found.push("link");

  const invited = body.match(INVITED);
  let projectName = clip(labelled(lines, LABELS.project), 200);
  if (!projectName && invited) projectName = clip(invited[2].replace(/["“”]/g, ""), 200);
  if (!projectName) for (const re of SUBJECT_PROJECT) {
    const m = originalSubject.match(re);
    if (m) {
      projectName = clip(m[1].replace(/["“”]/g, ""), 200);
      break;
    }
  }
  if (projectName) found.push("project");
  // Last resort: the bare subject line. Offered so the form is not empty, never counted as read.
  if (!projectName && originalSubject) projectName = clip(originalSubject, 200);

  let gcName = clip(labelled(lines, LABELS.gc), 160);
  if (!gcName && invited) gcName = clip(invited[1].replace(/^(?:hi|hello)[^,]*,\s*/i, ""), 160);
  if (!gcName) gcName = gcFromDisplayName(originalFromName);
  if (!gcName && originalFromName && platform === "EMAIL" && !isPlatformDomain(domainOf(originalFromEmail))) gcName = null;
  if (gcName) found.push("GC");

  const bidDue = parseItbDate(labelled(lines, LABELS.due), email.receivedAt);
  if (bidDue) found.push("due date");
  const siteWalk = parseItbDate(labelled(lines, LABELS.siteWalk), email.receivedAt);
  if (siteWalk) found.push("site walk");
  const preBidMeeting = parseItbDate(labelled(lines, LABELS.preBid), email.receivedAt);
  if (preBidMeeting) found.push("pre-bid meeting");
  const rfiDue = parseItbDate(labelled(lines, LABELS.rfi), email.receivedAt);
  if (rfiDue) found.push("RFI deadline");
  const address = parseAddress(labelled(lines, LABELS.address));
  if (address && (address.address1 || address.city || address.zipCode)) found.push("site");
  const scope = clip(labelled(lines, LABELS.scope), 1000);
  if (scope) found.push("scope");

  // The person to talk to: the original sender when a person wrote it, else
  // the first address in the body that is neither a platform's nor KNU's own.
  const own = opts.ownDomains ?? [];
  const usable = (e: string | null) => Boolean(e) && !isPlatformDomain(domainOf(e)) && !domainMatches(domainOf(e), own) && !/^(?:no-?reply|do-?not-?reply|notifications?|mailer|bounce)/i.test(e!);
  let contactEmail = usable(originalFromEmail) ? originalFromEmail : null;
  if (!contactEmail) {
    for (const m of body.matchAll(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
      const e = m[0].toLowerCase();
      if (usable(e)) {
        contactEmail = e;
        break;
      }
    }
  }
  const contactLabel = labelled(lines, LABELS.contact);
  const contactName = clip(contactLabel?.replace(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "").replace(/[|,;(]+\s*$/, ""), 120) || (contactEmail && contactEmail === originalFromEmail ? originalFromName : null);
  const phone = body.match(/(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
  if (contactEmail) found.push("contact");

  const haystack = `${originalSubject}\n${body.slice(0, 600)}`;
  const kind: ItbKind = /\baddend(?:um|a)\b/i.test(originalSubject) || /^\s*addend(?:um|a)\b/im.test(body.slice(0, 300))
    ? "ADDENDUM"
    : /\b(?:bid date (?:change|extension|has changed|moved)|postponed|extended|rescheduled|reminder|updated?\s+bid)\b/i.test(haystack) && !/invit/i.test(originalSubject)
      ? "UPDATE"
      : "INVITATION";

  return {
    kind,
    platform,
    platformUrl: link.url,
    platformRef: link.ref,
    projectName,
    gcName,
    bidDue,
    siteWalk,
    preBidMeeting,
    rfiDue,
    address,
    scope,
    originalFrom: { name: originalFromName, email: originalFromEmail },
    originalSubject,
    contactEmail,
    contactName: contactName || null,
    contactPhone: phone ? `(${phone[1]}) ${phone[2]}-${phone[3]}` : null,
    found,
  };
}

// ─── Matching ───────────────────────────────────────────────────────────────

const SUFFIXES = /\b(?:inc|incorporated|llc|l\.l\.c|corp|corporation|co|company|ltd|lp|llp|pllc|group|the)\b/g;
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(SUFFIXES, " ").replace(/\s+/g, " ").trim();
}

export type AccountCandidate = { id: string; name: string; website: string | null; email: string | null; contacts: { id: string; email: string | null }[] };
export type AccountMatch = { organizationId: string; contactId: string | null; how: "contact email" | "email domain" | "name" };

/**
 * Which account sent it, most certain first: a contact's own address, then the
 * company's email domain (never a mailbox provider's or a platform's), then
 * the GC's name. Two accounts tied at the same level is no match — a person
 * picks.
 */
export function matchAccount(p: Pick<ParsedItb, "originalFrom" | "contactEmail" | "gcName">, accounts: readonly AccountCandidate[]): AccountMatch | null {
  const emails = [p.originalFrom.email, p.contactEmail].filter((e): e is string => Boolean(e));
  for (const e of emails) {
    for (const a of accounts) {
      const c = a.contacts.find((x) => x.email?.toLowerCase() === e);
      if (c) return { organizationId: a.id, contactId: c.id, how: "contact email" };
    }
  }
  const unique = (ids: string[]) => {
    const set = [...new Set(ids)];
    return set.length === 1 ? set[0] : null;
  };
  for (const e of emails) {
    const d = domainOf(e);
    if (!d || domainMatches(d, FREE_MAIL_DOMAINS) || isPlatformDomain(d)) continue;
    const hits = accounts.filter((a) => {
      const own = [hostOf(a.website), domainOf(a.email), ...a.contacts.map((c) => domainOf(c.email))].filter((x): x is string => Boolean(x) && !domainMatches(x, FREE_MAIL_DOMAINS));
      return own.some((o) => d === o || d.endsWith(`.${o}`));
    });
    const id = unique(hits.map((a) => a.id));
    if (id) return { organizationId: id, contactId: null, how: "email domain" };
  }
  const gc = normalizeName(p.gcName);
  if (gc.length >= 3) {
    const exact = accounts.filter((a) => normalizeName(a.name) === gc);
    const id = unique(exact.map((a) => a.id));
    if (id) return { organizationId: id, contactId: null, how: "name" };
    const near = accounts.filter((a) => {
      const n = normalizeName(a.name);
      return n.length >= 5 && gc.length >= 5 && (n.includes(gc) || gc.includes(n));
    });
    const nid = unique(near.map((a) => a.id));
    if (nid) return { organizationId: nid, contactId: null, how: "name" };
  }
  return null;
}

export type BidCandidate = { id: string; number: string; organizationId: string; projectName: string; platformRef: string | null; status: string };

/** An invitation already logged: the platform's own id, else the same account and project. */
export function findExistingBid(p: Pick<ParsedItb, "platformRef" | "projectName">, organizationId: string | null, bids: readonly BidCandidate[]): BidCandidate | null {
  if (p.platformRef) {
    const hit = bids.find((b) => b.platformRef && b.platformRef === p.platformRef);
    if (hit) return hit;
  }
  if (!organizationId || !p.projectName) return null;
  const want = normalizeName(p.projectName);
  if (want.length < 4) return null;
  const same = bids.filter((b) => b.organizationId === organizationId);
  return (
    same.find((b) => normalizeName(b.projectName) === want) ??
    same.find((b) => {
      const n = normalizeName(b.projectName);
      return Math.min(n.length, want.length) >= 8 && (n.includes(want) || want.includes(n));
    }) ??
    null
  );
}

/** Trades named in the text, by the trade's own name on a word boundary. */
export function suggestTrades(text: string, trades: readonly { id: string; name: string }[]): string[] {
  const t = text.toLowerCase();
  return trades
    .filter((x) => {
      const n = x.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return n.length >= 3 && new RegExp(`(^|[^a-z])${n}s?([^a-z]|$)`).test(t);
    })
    .map((x) => x.id);
}

/**
 * Who may put mail in the queue through the open channels: someone at KNU
 * forwarding it, a known contact at an account, or a bid platform itself.
 * Anything else is kept as IGNORED and never reaches a person's list.
 */
export function senderAllowed(fromEmail: string | null, known: { userEmails: ReadonlySet<string>; contactEmails: ReadonlySet<string>; extraDomains?: readonly string[] }): boolean {
  const e = emailOf(fromEmail);
  if (!e) return false;
  return known.userEmails.has(e) || known.contactEmails.has(e) || isPlatformDomain(domainOf(e)) || domainMatches(domainOf(e), known.extraDomains ?? []);
}
