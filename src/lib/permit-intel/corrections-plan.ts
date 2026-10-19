import { z } from "zod";
import { addDayKeys, dayKey, type DayKey } from "@/lib/time/zone";

/**
 * Corrections, without the database. Pure and client-safe.
 *
 * A building department's correction notice is read by the AI into proposed
 * items (`extractionSchema` is what it must answer with); a person edits and
 * confirms them; each confirmed item becomes a task, a line of the response
 * letter and, on the next review, an outcome. Nothing here trusts the model:
 * every number is clamped, every name matched against what the permit holds.
 */

export const CORRECTION_CATEGORIES = ["ADMINISTRATIVE", "TECHNICAL", "ARCHITECTURAL", "ENGINEERING", "CONTRACTOR", "ZONING", "FEE", "OTHER"] as const;
export const CORRECTION_TARGETS = ["FORM", "PLAN_SHEET", "PRODUCT_APPROVAL", "SUPPORTING_DOCUMENT", "FEE", "SITE", "OTHER"] as const;
export const RESPONSIBLE_PARTIES = ["KNU", "ARCHITECT", "ENGINEER", "OWNER", "SUBCONTRACTOR", "MANUFACTURER", "MUNICIPALITY", "OTHER"] as const;
export const CORRECTION_STATUSES = ["PROPOSED", "OPEN", "WAITING_THIRD_PARTY", "RESOLVED", "DISPUTED", "WAIVED"] as const;

export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number];
export type CorrectionTarget = (typeof CORRECTION_TARGETS)[number];
export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const CATEGORY_LABEL: Record<CorrectionCategory, string> = {
  ADMINISTRATIVE: "Administrative",
  TECHNICAL: "Technical",
  ARCHITECTURAL: "Architectural",
  ENGINEERING: "Engineering",
  CONTRACTOR: "Contractor",
  ZONING: "Zoning",
  FEE: "Fee",
  OTHER: "Other",
};

export const TARGET_LABEL: Record<CorrectionTarget, string> = {
  FORM: "A form",
  PLAN_SHEET: "A plan sheet",
  PRODUCT_APPROVAL: "A product approval",
  SUPPORTING_DOCUMENT: "A supporting document",
  FEE: "A fee",
  SITE: "The site",
  OTHER: "Other",
};

export const PARTY_LABEL: Record<ResponsibleParty, string> = {
  KNU: "KNU",
  ARCHITECT: "Architect",
  ENGINEER: "Engineer",
  OWNER: "Owner",
  SUBCONTRACTOR: "Subcontractor",
  MANUFACTURER: "Manufacturer",
  MUNICIPALITY: "Building department",
  OTHER: "Someone else",
};

export const STATUS_LABEL: Record<CorrectionStatus, string> = {
  PROPOSED: "Proposed",
  OPEN: "Open",
  WAITING_THIRD_PARTY: "Waiting on someone",
  RESOLVED: "Resolved",
  DISPUTED: "Disputed",
  WAIVED: "Waived",
};

// ─── What the model answers with ────────────────────────────────────────────
// No numeric bounds in the schema (structured output ignores them); the
// mapping below clamps instead.

export const extractionSchema = z.object({
  summary: z.string().describe("Two or three plain sentences: who reviewed, what the notice asks for overall, any deadline it states."),
  reviewerName: z.string().nullable().describe("The plans examiner or reviewer named on the notice, or null."),
  statedDeadline: z.string().nullable().describe("A response deadline the notice states, as YYYY-MM-DD, or null when none is stated."),
  items: z.array(
    z.object({
      reviewerItemNumber: z.string().nullable().describe("The department's own number for the comment (\"B-3\", \"Zoning 2\", \"4\"), or null."),
      discipline: z.string().nullable().describe("The review discipline the comment is under (Building, Structural, Electrical, Zoning, Fire…), or null."),
      text: z.string().describe("The comment exactly as written on the notice. Do not paraphrase or shorten it."),
      page: z.number().int().nullable().describe("The 1-based page of the notice the comment is on, or null for pasted text."),
      category: z.enum(CORRECTION_CATEGORIES),
      affects: z.enum(CORRECTION_TARGETS),
      affectsRef: z.string().nullable().describe("The sheet number, form, product approval number or document the comment is about, as written (\"A-2.1\", \"NOA 21-0412.03\"), or null."),
      responsibleParty: z.enum(RESPONSIBLE_PARTIES).describe("Who has to act: KNU (the contractor) for forms, fees, contractor paperwork and site work; ARCHITECT / ENGINEER for anything on sealed drawings or calculations; OWNER for owner signatures or authorizations; MANUFACTURER for product approvals; MUNICIPALITY when the department itself must act."),
      partyName: z.string().nullable().describe("When the responsible party is one of the listed permit parties, that party's name exactly as listed; otherwise null."),
      repeatOf: z.string().nullable().describe("When the comment repeats a comment from the previous review listed in the input, that comment's reference (the ref value given); otherwise null."),
      confidence: z.number().describe("0 to 1: how sure you are this is one distinct correction the contractor must answer, read correctly."),
    }),
  ),
});
export type Extraction = z.infer<typeof extractionSchema>;

export type PartyRef = { id: string; name: string; role: string };
export type PreviousItemRef = { id: string; ref: string };

export type ProposedItem = {
  sortOrder: number;
  reviewerItemNumber: string | null;
  reviewerDiscipline: string | null;
  text: string;
  sourcePage: number | null;
  category: CorrectionCategory;
  affects: CorrectionTarget;
  affectsRef: string | null;
  responsibleParty: ResponsibleParty;
  partyId: string | null;
  confidence: number;
  previousItemId: string | null;
};

const tidy = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A party named by the model, matched to the permit's own list by name (never created). */
export function matchParty(name: string | null, parties: readonly PartyRef[]): string | null {
  const n = name ? norm(name) : "";
  if (!n) return null;
  const exact = parties.find((p) => norm(p.name) === n);
  if (exact) return exact.id;
  const partial = parties.filter((p) => {
    const pn = norm(p.name);
    return pn.length >= 4 && (pn.includes(n) || n.includes(pn));
  });
  return partial.length === 1 ? partial[0].id : null;
}

/**
 * The model's answer as rows to store, PROPOSED. Empty comments are dropped;
 * a page outside the document, a confidence outside 0–1, a party or earlier
 * comment the permit does not have are all cleared rather than trusted.
 */
export function proposedItems(out: Extraction, ctx: { parties: readonly PartyRef[]; previous: readonly PreviousItemRef[]; pageCount: number | null }): ProposedItem[] {
  const prevByRef = new Map(ctx.previous.map((p) => [norm(p.ref), p.id]));
  const rows: ProposedItem[] = [];
  for (const it of out.items) {
    const text = (it.text ?? "").trim();
    if (!text) continue;
    const page = it.page != null && Number.isInteger(it.page) && it.page >= 1 && (ctx.pageCount == null || it.page <= ctx.pageCount) ? it.page : null;
    rows.push({
      sortOrder: rows.length,
      reviewerItemNumber: tidy(it.reviewerItemNumber, 40),
      reviewerDiscipline: tidy(it.discipline, 60),
      text: text.slice(0, 8000),
      sourcePage: page,
      category: it.category,
      affects: it.affects,
      affectsRef: tidy(it.affectsRef, 120),
      responsibleParty: it.responsibleParty,
      partyId: matchParty(it.partyName, ctx.parties),
      confidence: Math.min(1, Math.max(0, Number.isFinite(it.confidence) ? it.confidence : 0)),
      previousItemId: it.repeatOf ? (prevByRef.get(norm(it.repeatOf)) ?? null) : null,
    });
  }
  return rows;
}

/** A deadline the model read, kept only when it is a real day within a year of the notice. */
export function statedDeadlineDay(v: string | null, receivedAt: Date): DayKey | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || dayKey(d, "UTC") !== v) return null;
  const days = (d.getTime() - receivedAt.getTime()) / 86_400_000;
  return days >= 0 && days <= 366 ? v : null;
}

// ─── Confirming ─────────────────────────────────────────────────────────────

/** A confirmed item is open, or waiting when someone outside KNU must act. */
export function statusOnConfirm(party: ResponsibleParty): "OPEN" | "WAITING_THIRD_PARTY" {
  return party === "KNU" || party === "MUNICIPALITY" ? "OPEN" : "WAITING_THIRD_PARTY";
}

export const isClosedStatus = (s: CorrectionStatus) => s === "RESOLVED" || s === "WAIVED";

/** Statuses a person may set on a confirmed item (PROPOSED belongs to the notice's review). */
export function canMoveTo(from: CorrectionStatus, to: CorrectionStatus): boolean {
  if (from === "PROPOSED" || to === "PROPOSED") return from === to;
  return true;
}

/** The days a corrected package is due back when the notice states none. */
export const DEFAULT_RESUBMIT_DAYS = 14;

export function resubmitDueDay(receivedAt: Date, stated: DayKey | null): DayKey {
  return stated ?? addDayKeys(dayKey(receivedAt), DEFAULT_RESUBMIT_DAYS);
}

export const correctionsReceivedKey = (permitId: string, cycle: number) => `permit:${permitId}:corrections@${cycle}`;
export const resubmitKey = (permitId: string, cycle: number) => `permit:${permitId}:resubmit@${cycle}`;
export const correctionItemKey = (itemId: string) => `permit-correction:${itemId}`;

export type ItemForTask = {
  reviewerItemNumber: string | null;
  text: string;
  affects: CorrectionTarget;
  affectsRef: string | null;
  responsibleParty: ResponsibleParty;
  partyName: string | null;
};

const short = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};

/** The task an item becomes. KNU's own work reads as the correction; anyone else's as "Get … from …". */
export function itemTask(item: ItemForTask, permitLabel: string): { title: string; description: string; priority: "HIGH" | "MEDIUM" } {
  const what = item.affectsRef ?? TARGET_LABEL[item.affects].replace(/^(An?|The) /, "").toLowerCase();
  const external = item.responsibleParty !== "KNU" && item.responsibleParty !== "MUNICIPALITY";
  const who = item.partyName ?? `the ${PARTY_LABEL[item.responsibleParty].toLowerCase()}`;
  const ref = item.reviewerItemNumber ? ` (comment ${item.reviewerItemNumber})` : "";
  const title = external ? `Get the revised ${what} from ${who}${ref}` : `Correction${item.reviewerItemNumber ? ` ${item.reviewerItemNumber}` : ""}: ${short(item.text, 70)}`;
  const description = [
    `The building department's comment${item.reviewerItemNumber ? ` ${item.reviewerItemNumber}` : ""} on the ${permitLabel}:`,
    "",
    item.text,
    "",
    external ? `${PARTY_LABEL[item.responsibleParty]} must revise it. Link the revised file to the item on the permit's Corrections tab, then mark it resolved.` : "Answer it, write the response line on the permit's Corrections tab, then mark it resolved.",
  ].join("\n");
  return { title: short(title, 200), description, priority: external ? "MEDIUM" : "HIGH" };
}

// ─── The next review ────────────────────────────────────────────────────────

export type EarlierItem = { id: string; status: CorrectionStatus; reviewOutcome: "ACCEPTED" | "RECOMMENTED" | null };

/**
 * When the department answers again, each confirmed item of the earlier
 * notices gets its outcome: commented on again (a new item names it) or
 * accepted. Proposed items never counted; an outcome already set is kept.
 */
export function earlierOutcomes(earlier: readonly EarlierItem[], repeatedIds: ReadonlySet<string>, cycleApproved: boolean): { id: string; outcome: "ACCEPTED" | "RECOMMENTED" }[] {
  const out: { id: string; outcome: "ACCEPTED" | "RECOMMENTED" }[] = [];
  for (const e of earlier) {
    if (e.status === "PROPOSED" || e.reviewOutcome) continue;
    if (repeatedIds.has(e.id) && !cycleApproved) out.push({ id: e.id, outcome: "RECOMMENTED" });
    else out.push({ id: e.id, outcome: "ACCEPTED" });
  }
  return out;
}

// ─── Response letter ────────────────────────────────────────────────────────

export type LetterItem = { id: string; reviewerItemNumber: string | null; reviewerDiscipline: string | null; text: string; response: string | null; status: CorrectionStatus; revisedFiles: string[] };
export type LetterLine = { number: string; discipline: string | null; comment: string; response: string; revised: string[] };

/**
 * The lines of a point-by-point response: every confirmed item of the notice
 * in order. An item still open without a response line blocks the letter —
 * the department would read a blank as an unanswered comment.
 */
export function letterLines(items: readonly LetterItem[]): { lines: LetterLine[]; unanswered: LetterItem[] } {
  const confirmed = items.filter((i) => i.status !== "PROPOSED");
  const unanswered = confirmed.filter((i) => !(i.response ?? "").trim());
  const lines = confirmed.map((i, n) => ({
    number: i.reviewerItemNumber ?? String(n + 1),
    discipline: i.reviewerDiscipline,
    comment: i.text,
    response: (i.response ?? "").trim(),
    revised: i.revisedFiles,
  }));
  return { lines, unanswered };
}

// ─── Extraction housekeeping ────────────────────────────────────────────────

export const MAX_EXTRACT_ATTEMPTS = 3;
/** A reading still "running" after this long was cut off by a restart: it is started again. */
export const STALE_EXTRACT_MS = 5 * 60 * 1000;

export function isStaleExtraction(n: { status: string; extractStartedAt: Date | null; attempts: number }, now: Date): boolean {
  if (n.status !== "EXTRACTING" || n.attempts >= MAX_EXTRACT_ATTEMPTS) return false;
  return !n.extractStartedAt || now.getTime() - n.extractStartedAt.getTime() > STALE_EXTRACT_MS;
}
