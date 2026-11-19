import { atLocalTime, localParts, type DayKey } from "@/lib/time/zone";

/**
 * Reading what "Send to CRM" brings from a PlanHub page — the Bid Board or
 * one project's page — as it is on the screen. Deterministic and pure: no
 * model, no network. A value the page does not show is null, never guessed.
 *
 * PlanHub's pages print Material icon names as words ("calendar_month",
 * "check", "person"); they are dropped before reading.
 */

export const PLANHUB_STAGES = ["SAVED", "ESTIMATING", "BIDDING", "SUBMITTED", "WON", "LOST"] as const;
export type PlanhubStageKey = (typeof PLANHUB_STAGES)[number];

export const PLANHUB_STAGE_LABEL: Record<PlanhubStageKey, string> = { SAVED: "Saved", ESTIMATING: "Estimating", BIDDING: "Bidding", SUBMITTED: "Submitted", WON: "Won", LOST: "Lost" };

/** What the bookmarklet posts. `cards` is one entry per Bid Board card when the page has them. */
export type PlanhubPayload = { url: string; text: string; cards?: { text: string; column?: string | null }[] | null };

export type BoardCard = { name: string; stage: PlanhubStageKey | null; dueOn: DayKey | null; dueText: string | null; bidValue: number | null };

export type ProjectPageGc = {
  name: string;
  website: string | null;
  addressText: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** The GC's status on PlanHub ("BIDDING", "PROSPECTIVE"); null when the page shows none. */
  status: string | null;
  /** This GC's own due date (each GC on a project may set its own). */
  bidDueAt: string | null;
  bidDueHasTime: boolean;
};

export type ProjectPage = {
  platformRef: string;
  platformUrl: string;
  name: string | null;
  address: { address1: string | null; city: string | null; state: string | null; zipCode: string | null; text: string } | null;
  description: string | null;
  trades: string[];
  moreTrades: number | null;
  projectValue: number | null;
  postedOn: DayKey | null;
  bidDueAt: string | null; // ISO instant; noon when the page gives no time
  bidDueHasTime: boolean;
  status: string | null;
  constructionType: string | null;
  projectType: string | null;
  buildingUse: string | null;
  prevailingWage: boolean | null;
  /** Every GC the page lists: one ("About us") or several ("General Contractors"). */
  gcs: ProjectPageGc[];
};

export type ReadPage = { kind: "BOARD"; cards: BoardCard[] } | { kind: "PROJECT"; project: ProjectPage } | { kind: "UNKNOWN"; reason: string };

const HOSTS = /(^|\.)planhub\.com$/i;

/** The page kind from its address; anything not on planhub.com is refused. */
export function pageKindOf(url: string): { kind: "BOARD" } | { kind: "PROJECT"; ref: string } | { kind: "UNKNOWN"; reason: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "UNKNOWN", reason: "The page address could not be read." };
  }
  if (u.protocol !== "https:" || !HOSTS.test(u.hostname)) return { kind: "UNKNOWN", reason: "This is not a PlanHub page." };
  const ref = u.pathname.match(/\/(?:leads\/details|projects?)\/(\d{3,})(?:\/|$)/);
  if (ref) return { kind: "PROJECT", ref: ref[1] };
  if (/\/bid-management(\/|$)/.test(u.pathname)) return { kind: "BOARD" };
  return { kind: "UNKNOWN", reason: "Open the Bid Board or one project's page on PlanHub, then click Send to CRM." };
}

/** A project page's address without the "from" and other query values. */
export function canonicalProjectUrl(url: string, ref: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/leads/details/${ref}/project-info`;
}

const ICON = /^[a-z]+(?:_[a-z]+)*$/;
const ICON_WORDS = new Set(["check", "add", "map", "person", "mail", "phone", "language", "business", "construction", "assignment", "home_work", "calendar_month", "pin_drop", "open_in_new", "local_offer", "history", "arrow_right", "bar_chart", "expand_more", "auto_awesome", "arrow_circle_up", "send", "bookmark", "navigate_before", "close", "edit", "star", "more_vert", "question_mark"]);

function lines(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const isIcon = (l: string) => ICON_WORDS.has(l) || (ICON.test(l) && l.includes("_"));

export function stageOf(word: string | null | undefined): PlanhubStageKey | null {
  const w = word?.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!w) return null;
  // The narrow board's column picker says "bid_submitted"; a help page says "Submitting".
  if (w === "SUBMITTING" || w === "BID_SUBMITTED") return "SUBMITTED";
  return (PLANHUB_STAGES as readonly string[]).includes(w) ? (w as PlanhubStageKey) : null;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "DUE DEC 04" carries no year: the year that puts the day nearest to today
 * (a card due Jan 22 seen in November is next January; one due Nov 18 seen
 * on Nov 19 is yesterday).
 */
export function dueOnFromCard(text: string, now: Date): DayKey | null {
  const m = text.toUpperCase().match(/\bDUE\s+([A-Z]{3})[A-Z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]) + 1;
  const day = Number(m[2]);
  if (month < 1 || day < 1 || day > 31) return null;
  if (m[3]) return `${m[3]}-${pad(month)}-${pad(day)}`;
  const today = localParts(now);
  const base = Date.UTC(today.year, today.month - 1, today.day);
  let best: { key: DayKey; gap: number } | null = null;
  for (const y of [today.year - 1, today.year, today.year + 1]) {
    const t = Date.UTC(y, month - 1, day);
    if (new Date(t).getUTCDate() !== day) continue;
    const gap = Math.abs(t - base);
    if (!best || gap < best.gap) best = { key: `${y}-${pad(month)}-${pad(day)}`, gap };
  }
  return best?.key ?? null;
}

function money(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/\$?\s*(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** One card's text ("PLANHUB / name / Bid Value: $0 / RC / DUE JAN 22 / Prepare Takeoff"). */
export function parseCard(text: string, column: string | null | undefined, now: Date): BoardCard | null {
  const ls = lines(text).filter((l) => !isIcon(l));
  const vi = ls.findIndex((l) => /^bid value\b/i.test(l));
  let name: string | null = vi > 0 ? ls[vi - 1] : null;
  if (!name) name = ls.find((l) => !/^(planhub|imported|private|bid value|due\b|prepare takeoff)/i.test(l) && l.length > 3) ?? null;
  if (!name) return null;
  const due = ls.find((l) => /^DUE\b/i.test(l)) ?? null;
  return { name, stage: stageOf(column), dueOn: due ? dueOnFromCard(due, now) : null, dueText: due, bidValue: vi >= 0 ? money(ls[vi]) : null };
}

/**
 * The Bid Board. With per-card text from the bookmarklet, each card is read
 * with its column; otherwise the page text is walked, a lone stage word
 * ("saved") opening a column and each "Bid Value" line closing a card's name.
 */
export function parseBoard(payload: PlanhubPayload, now: Date): BoardCard[] {
  const out: BoardCard[] = [];
  if (payload.cards?.length) {
    for (const c of payload.cards) {
      const card = parseCard(c.text, c.column, now);
      if (card) out.push(card);
    }
    return dedupeCards(out);
  }
  // Stage words are read before icon words are dropped ("bid_submitted" looks like an icon name).
  const ls = lines(payload.text).filter((l) => (/^[a-z_]+$/.test(l) && stageOf(l)) || !isIcon(l));
  let stage: PlanhubStageKey | null = null;
  for (let i = 0; i < ls.length; i++) {
    const asStage = /^[a-z_]+$/.test(ls[i]) ? stageOf(ls[i]) : null;
    if (asStage) {
      stage = asStage;
      continue;
    }
    if (!/^bid value\b/i.test(ls[i]) || i === 0) continue;
    let due: string | null = null;
    for (let j = i + 1; j < Math.min(ls.length, i + 6); j++) {
      if (/^bid value\b/i.test(ls[j])) break;
      if (/^DUE\b/i.test(ls[j])) {
        due = ls[j];
        break;
      }
    }
    out.push({ name: ls[i - 1], stage, dueOn: due ? dueOnFromCard(due, now) : null, dueText: due, bidValue: money(ls[i]) });
  }
  return dedupeCards(out);
}

function dedupeCards(cards: BoardCard[]): BoardCard[] {
  const seen = new Set<string>();
  return cards.filter((c) => {
    const k = `${c.name.toLowerCase()}|${c.stage}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const STREET = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|ter|terrace|way|pl|place|hwy|highway|pkwy|parkway|cir|circle|trl|trail|cswy|causeway|sq|plz|plaza)\.?\b/gi;

/**
 * "4200 NW 21st St Miami, FL 33142" (no comma after the street) as well as
 * "1011 Main St, Suite 9, Miami, FL, 33136".
 */
export function splitAddress(raw: string | null | undefined): ProjectPage["address"] {
  if (!raw) return null;
  const text = raw.replace(/\s+/g, " ").trim();
  const m = text.match(/^(.*?),?\s*([A-Z]{2})\.?,?\s*(\d{5})(?:-\d{4})?\s*$/);
  if (!m) return { address1: /^\d/.test(text) ? text : null, city: null, state: null, zipCode: text.match(/\b\d{5}\b/)?.[0] ?? null, text };
  const [, head, state, zip] = m;
  const parts = head.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { address1: parts.slice(0, -1).join(", "), city: parts[parts.length - 1], state, zipCode: zip, text };
  // One part: the city follows the last street word.
  let cut = -1;
  for (const s of head.matchAll(STREET)) cut = (s.index ?? 0) + s[0].length;
  if (cut > 0 && cut < head.length) return { address1: head.slice(0, cut).trim(), city: head.slice(cut).replace(/^[.,\s]+/, "").trim() || null, state, zipCode: zip, text };
  return { address1: /^\d/.test(head) ? head : null, city: /^\d/.test(head) ? null : head, state, zipCode: zip, text };
}

function usDate(s: string | null): DayKey | null {
  const m = s?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}` : null;
}

/** "DUE 11/30/2026 02:00 PM" → the instant in office time; a bare date → noon. */
export function parseDueLine(s: string | null | undefined): { at: string; hasTime: boolean } | null {
  const m = s?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?/i);
  if (!m) return null;
  const key: DayKey = `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
  if (!m[4]) return { at: atLocalTime(key, 12, 0).toISOString(), hasTime: false };
  let h = Number(m[4]) % 12;
  if (m[6].toUpperCase() === "PM") h += 12;
  return { at: atLocalTime(key, h, Number(m[5])).toISOString(), hasTime: true };
}

/** One project's page ("Project Info"). */
export function parseProjectPage(payload: PlanhubPayload, ref: string): ProjectPage {
  const all = lines(payload.text);
  const ls = all.filter((l) => !isIcon(l));
  const after = (label: string): string | null => {
    const i = ls.findIndex((l) => l.toLowerCase() === label.toLowerCase());
    const v = i >= 0 ? ls[i + 1] : null;
    return v && v !== "-" ? v : null;
  };

  const ai = ls.findIndex((l) => l === "AskAI");
  const ao = ls.findIndex((l) => l === "Account Overview");
  const name = ai > 0 ? ls[ai - 1] : ao >= 0 ? (ls[ao + 1] ?? null) : null;

  const li = ls.findIndex((l) => l === "Project Location");
  let addressLine: string | null = null;
  if (li >= 0) for (let i = li + 1; i < Math.min(ls.length, li + 4); i++) if (!/^view full map$/i.test(ls[i])) { addressLine = ls[i]; break; }

  const ti = ls.findIndex((l) => l === "Trades Needed");
  const trades: string[] = [];
  let moreTrades: number | null = null;
  if (ti >= 0) {
    for (let i = ti + 1; i < ls.length; i++) {
      const more = ls[i].match(/^show all (\d+) trades$/i);
      if (more) {
        moreTrades = Number(more[1]);
        break;
      }
      if (/^(project details|special instructions|about us)$/i.test(ls[i])) break;
      trades.push(ls[i]);
    }
  }

  const di = ls.findIndex((l) => l === "About This Project");
  let description: string | null = null;
  if (di >= 0) {
    const parts: string[] = [];
    for (let i = di + 1; i < ls.length && !/^(see more|project fit)$/i.test(ls[i]); i++) parts.push(ls[i]);
    description = parts.join(" ").replace(/\.\.\.$/, "…") || null;
  }

  const dueLine = ls.find((l) => /^DUE \d{1,2}\/\d{1,2}\/\d{4}/i.test(l)) ?? (after("Bid Due Date") ? `DUE ${after("Bid Due Date")}` : null);
  const gcs = parseGcs(all, parseDueLine(dueLine));

  const due = parseDueLine(dueLine);
  const labor = after("Sector Labor Status");

  return {
    platformRef: ref,
    platformUrl: canonicalProjectUrl(payload.url, ref),
    name,
    address: splitAddress(addressLine),
    description,
    trades,
    moreTrades,
    projectValue: money(after("Project Value")),
    postedOn: usDate(after("Project Posted Date")),
    bidDueAt: due?.at ?? null,
    bidDueHasTime: due?.hasTime ?? false,
    status: after("Project Status"),
    constructionType: after("Construction Type"),
    projectType: after("Project Type"),
    buildingUse: after("Building Use"),
    prevailingWage: labor ? /prevailing/i.test(labor) : null,
    gcs,
  };
}

const AVATAR = /^[A-Z0-9]{1,3}$/;
const GC_END = /^(special instructions|market intelligence|intend to bid)$/i;

/**
 * The GCs on a project's page. One GC: an "About us" block (name, website,
 * office address, a named primary contact). Several: a "General Contractors"
 * list, each GC with an email, a phone, its status and its own due date, and
 * ending at its "Special Instructions" link. Icon words say what each value is.
 */
function parseGcs(all: string[], pageDue: { at: string; hasTime: boolean } | null): ProjectPageGc[] {
  const after = (block: string[], icon: string) => {
    const k = block.indexOf(icon);
    const v = k >= 0 ? block[k + 1] : null;
    return v && !isIcon(v) && !/^not provided$/i.test(v) ? v : null;
  };
  const statusOf = (block: string[]) => {
    const k = block.indexOf("local_offer");
    for (let i = k + 1; k >= 0 && i < Math.min(block.length, k + 4); i++) if (/^[A-Z][A-Z _]+$/.test(block[i]) && !/^DUE\b/.test(block[i])) return block[i];
    return null;
  };
  const dueOf = (block: string[]) => parseDueLine(block.find((l) => /^DUE \d{1,2}\/\d{1,2}\/\d{4}/i.test(l))) ?? pageDue;

  const li = all.findIndex((l) => l === "General Contractors");
  if (li >= 0) {
    const out: ProjectPageGc[] = [];
    let block: string[] = [];
    const flush = () => {
      const name = block.find((l) => !isIcon(l) && !AVATAR.test(l) && !/^all bidding statuses$/i.test(l));
      if (name && (block.includes("mail") || block.includes("phone") || block.some((l) => /^DUE\b/.test(l)))) {
        const due = dueOf(block);
        out.push({ name, website: null, addressText: null, contactName: after(block, "person"), contactEmail: after(block, "mail")?.toLowerCase() ?? null, contactPhone: after(block, "phone"), status: statusOf(block), bidDueAt: due?.at ?? null, bidDueHasTime: due?.hasTime ?? false });
      }
      block = [];
    };
    for (let i = li + 1; i < all.length; i++) {
      const l = all[i];
      if (/^(market intelligence|intend to bid|bar_chart)$/i.test(l)) break;
      if (l === "Special Instructions") {
        flush();
        continue;
      }
      block.push(l);
    }
    flush();
    return out;
  }

  const gi = all.findIndex((l) => l === "About us");
  if (gi < 0) return [];
  const block: string[] = [];
  for (let i = gi + 1; i < all.length && !GC_END.test(all[i]); i++) block.push(all[i]);
  const name = block.find((l) => !isIcon(l) && !AVATAR.test(l));
  if (!name || /^view profile$/i.test(name)) return [];
  const contact = after(block, "person");
  const due = dueOf(block);
  return [
    {
      name,
      website: block.find((l) => /^https?:\/\//i.test(l)) ?? null,
      addressText: after(block, "pin_drop"),
      contactName: contact ? contact.replace(/\s*\((?:primary )?contact\)\s*$/i, "").trim() || null : null,
      contactEmail: after(block, "mail")?.toLowerCase() ?? null,
      contactPhone: after(block, "phone"),
      status: statusOf(block),
      bidDueAt: due?.at ?? null,
      bidDueHasTime: due?.hasTime ?? false,
    },
  ];
}

export function readPage(payload: PlanhubPayload, now: Date = new Date()): ReadPage {
  const k = pageKindOf(payload.url);
  if (k.kind === "UNKNOWN") return k;
  if (k.kind === "BOARD") {
    const cards = parseBoard(payload, now);
    return cards.length ? { kind: "BOARD", cards } : { kind: "UNKNOWN", reason: "No projects were found on the Bid Board. Wait for the board to finish loading and click Send to CRM again." };
  }
  return { kind: "PROJECT", project: parseProjectPage(payload, k.ref) };
}

/** First and last name from "Jithu Sabu Daniel" (the last word is the last name). */
export function splitPersonName(full: string | null | undefined): { firstName: string; lastName: string } | null {
  const w = full?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!w.length) return null;
  if (w.length === 1) return { firstName: w[0], lastName: "-" };
  return { firstName: w.slice(0, -1).join(" "), lastName: w[w.length - 1] };
}

