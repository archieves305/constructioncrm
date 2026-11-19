import { z } from "zod";

/**
 * Reading a KNU estimate / proposal (and the PlanHub invitation beside it)
 * into a review a person confirms. Pure: the answer schema the model must
 * match, the mapping from its answer to a review draft, what blocks
 * confirmation, and how much of a proposal one GC was quoted.
 *
 * Nothing here decides a fact. The model proposes values with where it read
 * them and how sure it is; a person checks them; only a VERIFIED version's
 * amounts reach a submission or an email.
 */

export const MAX_EXTRACT_ATTEMPTS = 3;
export const STALE_EXTRACT_MS = 5 * 60_000;
/** Below this the review shows the value as "check this". */
export const UNCERTAIN_BELOW = 0.7;

// Kept small on purpose: the structured-output API refuses a schema with more
// than 16 nullable parameters or a grammar that compiles too large. So every
// value is a plain string ("" = not written) in one flat object, and where
// each was read, with how sure, is a separate list.
export const LINE_KINDS = ["BASE", "ALTERNATE", "ALLOWANCE", "UNIT"] as const;

export const VALUE_KEYS = ["projectName", "address1", "city", "state", "zipCode", "county", "projectType", "ownerName", "proposalNumber", "proposalDate", "validUntil", "validityDays", "knuCompany", "currency", "baseBid", "gcCompany", "subDeadline", "ownerDeadline", "expectedAwardDate", "expectedStartDate", "planhubProjectId", "planhubUrl"] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];

export const extractionSchema = z.object({
  documentKind: z.enum(["proposal", "estimate", "invitation", "other"]),
  summary: z.string(),
  values: z.object(Object.fromEntries(VALUE_KEYS.map((k) => [k, z.string()])) as Record<ValueKey, z.ZodString>),
  evidence: z.array(z.object({ field: z.string(), source: z.string(), confidence: z.number() })),
  gcContacts: z.array(z.object({ name: z.string(), email: z.string(), phone: z.string(), title: z.string() })),
  lines: z.array(z.object({ trade: z.string(), description: z.string(), kind: z.enum(LINE_KINDS), amount: z.number(), source: z.string(), confidence: z.number() })),
  bundleOnly: z.boolean(),
  inclusions: z.array(z.string()),
  exclusions: z.array(z.string()),
  clarifications: z.array(z.string()),
  conflicts: z.array(z.object({ field: z.string(), values: z.array(z.object({ value: z.string(), source: z.string() })) })),
});
export type Extraction = z.infer<typeof extractionSchema>;

// ── The review draft ─────────────────────────────────────────────────────

export type FieldState = "ok" | "uncertain" | "missing";
export type ReviewField = { value: string; source: string | null; confidence: number | null; state: FieldState };

export const REVIEW_FIELDS = ["projectName", "address1", "city", "state", "zipCode", "county", "projectType", "ownerName", "proposalNumber", "proposalDate", "validUntil", "baseBid", "gcCompany", "subDeadline", "ownerDeadline", "expectedAwardDate", "expectedStartDate", "planhubProjectId", "planhubUrl"] as const;
export type ReviewFieldKey = (typeof REVIEW_FIELDS)[number];

/** Must be filled before the version can be confirmed. */
export const REQUIRED_FIELDS: readonly ReviewFieldKey[] = ["projectName", "baseBid"];

export type ReviewLine = { serviceCategoryId: string | null; tradeText: string; description: string; kind: (typeof LINE_KINDS)[number]; amount: number; source: string | null; confidence: number | null };
export type ReviewContact = { name: string; email: string | null; phone: string | null; title: string | null; source: string | null };

export type ReviewDraft = {
  fields: Record<ReviewFieldKey, ReviewField>;
  lines: ReviewLine[];
  bundleOnly: boolean;
  inclusions: string;
  exclusions: string;
  clarifications: string;
  alternates: string;
  gcContacts: ReviewContact[];
  conflicts: { field: string; values: { value: string; source: string | null }[] }[];
  summary: string;
  documentKind: Extraction["documentKind"];
};

/** A trade name as written → the CRM's trade, by name (and a few words that mean it). */
const SYNONYMS: Record<string, string[]> = {
  drywall: ["drywall", "gypsum", "sheetrock", "metal stud", "framing and drywall", "board", "gwb"],
  plumbing: ["plumbing", "plumber", "sanitary", "domestic water", "fixtures"],
  roofing: ["roofing", "roof", "reroof", "re-roof", "membrane", "shingle"],
  windows: ["windows", "window", "glazing", "storefront"],
  doors: ["doors", "door", "frames and hardware"],
  demolition: ["demolition", "demo", "selective demo"],
};

export function tradeFor(written: string, trades: readonly { id: string; name: string }[]): string | null {
  const w = written.toLowerCase();
  const exact = trades.find((t) => t.name.toLowerCase() === w.trim());
  if (exact) return exact.id;
  const hits = trades.filter((t) => {
    const n = t.name.toLowerCase();
    const words = SYNONYMS[n] ?? [n];
    return words.some((s) => new RegExp(`(^|[^a-z])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?([^a-z]|$)`).test(w));
  });
  return hits.length === 1 ? hits[0]!.id : null;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function reviewField(x: Extraction, k: ValueKey): ReviewField {
  const value = str(x.values[k]);
  if (!value) return { value: "", source: null, confidence: null, state: "missing" };
  const ev = x.evidence.find((e) => e.field === k);
  const confidence = ev ? clamp01(ev.confidence) : null;
  return { value, source: str(ev?.source) || null, confidence, state: confidence !== null && confidence < UNCERTAIN_BELOW ? "uncertain" : "ok" };
}

/** "$665,500.00" → "665500" — the review edits a plain number. */
function moneyText(v: string): string {
  const n = Number(v.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return v && Number.isFinite(n) ? String(Math.round(n * 100) / 100) : v;
}

/** A date the model wrote, as yyyy-mm-dd when it is one (the review edits days). */
export function dayOf(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
  return m ? m[1]! : v.trim();
}

/** The model's answer → the draft a person reviews. A `validityDays` with a date and no expiry becomes the expiry. */
export function draftFromExtraction(x: Extraction, trades: readonly { id: string; name: string }[]): ReviewDraft {
  const fields = Object.fromEntries(REVIEW_FIELDS.map((k) => [k, reviewField(x, k)])) as Record<ReviewFieldKey, ReviewField>;
  for (const k of ["proposalDate", "validUntil"] as const) if (fields[k].value) fields[k].value = dayOf(fields[k].value);
  if (fields.baseBid.value) fields.baseBid.value = moneyText(fields.baseBid.value);
  const days = Number(x.values.validityDays);
  const daysEv = x.evidence.find((e) => e.field === "validityDays");
  if (!fields.validUntil.value && fields.proposalDate.value && days > 0 && days < 400) {
    const d = new Date(`${fields.proposalDate.value}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCDate(d.getUTCDate() + Math.round(days));
      fields.validUntil = { value: d.toISOString().slice(0, 10), source: str(daysEv?.source) || null, confidence: Math.min(clamp01(daysEv?.confidence ?? 0.5), fields.proposalDate.confidence ?? 1), state: "uncertain" };
    }
  }
  // A bundle discount printed as a negative line with no single trade is the bundle adjustment
  // (total − Σ base lines), never a line of its own: drop it; the review shows the difference.
  const read = x.lines.filter((l) => !(l.kind === "BASE" && l.amount < 0 && tradeFor(l.trade, trades) === null));
  const lines: ReviewLine[] = read.map((l) => ({ serviceCategoryId: tradeFor(l.trade, trades), tradeText: l.trade, description: str(l.description), kind: l.kind, amount: Math.round(l.amount * 100) / 100, source: str(l.source) || null, confidence: clamp01(l.confidence) }));
  const conflictsIn = x.conflicts.map((c) => ({ field: c.field, values: c.values.map((v) => ({ value: v.value, source: str(v.source) || null })) }));
  const conflicts = [...conflictsIn];
  const base = lines.filter((l) => l.kind === "BASE").reduce((s, l) => s + l.amount, 0);
  const total = Number(fields.baseBid.value);
  const discount = x.lines.filter((l) => !read.includes(l)).reduce((t, l) => t + l.amount, 0);
  if (lines.some((l) => l.kind === "BASE") && fields.baseBid.value && Number.isFinite(total) && Math.abs(base - total) > 1 && Math.abs(base + discount - total) > 1 && !x.bundleOnly) {
    conflicts.push({ field: "baseBid", values: [{ value: String(total), source: fields.baseBid.source }, { value: String(Math.round(base * 100) / 100), source: "sum of the base lines" }] });
  }
  return {
    fields,
    lines,
    bundleOnly: x.bundleOnly,
    inclusions: x.inclusions.join("\n"),
    exclusions: x.exclusions.join("\n"),
    clarifications: x.clarifications.join("\n"),
    alternates: lines.filter((l) => l.kind === "ALTERNATE").map((l) => `${l.description || l.tradeText}: ${l.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}`).join("\n"),
    gcContacts: x.gcContacts.filter((c) => str(c.name) || str(c.email)).map((c) => ({ name: str(c.name), email: str(c.email) || null, phone: str(c.phone) || null, title: str(c.title) || null, source: null })),
    conflicts,
    summary: x.summary,
    documentKind: x.documentKind,
  };
}

/** An empty draft for typing by hand (no AI, or the reading failed). */
export function emptyDraft(): ReviewDraft {
  return {
    fields: Object.fromEntries(REVIEW_FIELDS.map((k) => [k, { value: "", source: null, confidence: null, state: "missing" as const }])) as Record<ReviewFieldKey, ReviewField>,
    lines: [],
    bundleOnly: false,
    inclusions: "",
    exclusions: "",
    clarifications: "",
    alternates: "",
    gcContacts: [],
    conflicts: [],
    summary: "",
    documentKind: "other",
  };
}

/** The total the lines and the adjustment give: Σ BASE + adjustment (a bundle discount is negative). */
export function baseTotal(lines: readonly { kind: string; amount: number }[], bundleAdjustment = 0): number {
  return Math.round((lines.filter((l) => l.kind === "BASE").reduce((s, l) => s + l.amount, 0) + bundleAdjustment) * 100) / 100;
}

export type ConfirmInput = {
  total: number;
  bundleAdjustment: number;
  lines: { serviceCategoryId: string | null; kind: (typeof LINE_KINDS)[number]; description: string | null; amount: number }[];
  projectName: string | null;
  creatingProject: boolean;
  gcs: { organizationId: string | null; bidDueAt: string | null }[];
};

/** What stops confirmation. Each is a sentence a person can act on. */
export function confirmProblems(c: ConfirmInput): string[] {
  const out: string[] = [];
  if (c.creatingProject && !(c.projectName && c.projectName.trim().length >= 2)) out.push("Name the project");
  if (!(c.total > 0)) out.push("Enter the total base bid");
  const base = c.lines.filter((l) => l.kind === "BASE");
  if (base.length === 0) out.push("Add at least one base line (a trade and its price)");
  if (base.some((l) => !(l.amount > 0))) out.push("Every base line needs an amount");
  const unsplit = base.filter((l) => !l.serviceCategoryId);
  if (unsplit.length > 1) out.push("Only one base line can be an unsplit bundle; pick a trade for the others");
  if (base.length && Math.abs(baseTotal(c.lines, c.bundleAdjustment) - c.total) > 0.5) out.push("The base lines and the bundle adjustment do not add up to the total");
  if (c.lines.some((l) => l.kind !== "BASE" && !(l.amount >= 0))) out.push("An alternate, allowance or unit price has no amount");
  if (c.gcs.some((g) => !g.organizationId)) out.push("Pick the GC for every GC row, or remove the row");
  return out;
}

/**
 * The price one GC was quoted from a version: the BASE lines for the scopes
 * that GC bids, plus an unsplit bundle line, plus the bundle adjustment only
 * when the GC bids every scope the version prices (a partial set never takes
 * the bundle discount).
 */
export function amountForScopes(version: { bundleAdjustment: number; lines: readonly { scopeId: string | null; kind: string; amount: number }[] }, scopeIds: readonly string[]): number {
  const base = version.lines.filter((l) => l.kind === "BASE");
  const priced = new Set(base.map((l) => l.scopeId).filter((x): x is string => Boolean(x)));
  const mine = base.filter((l) => l.scopeId === null || scopeIds.includes(l.scopeId));
  const all = [...priced].every((s) => scopeIds.includes(s));
  const sum = mine.reduce((s, l) => s + l.amount, 0) + (all ? version.bundleAdjustment : 0);
  return Math.round(sum * 100) / 100;
}

/** Per scope, what this GC was quoted (null when the version priced the scope only inside a bundle). */
export function quotedByScope(version: { lines: readonly { scopeId: string | null; kind: string; amount: number }[] }, scopeIds: readonly string[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const id of scopeIds) {
    const own = version.lines.filter((l) => l.kind === "BASE" && l.scopeId === id);
    out.set(id, own.length ? Math.round(own.reduce((s, l) => s + l.amount, 0) * 100) / 100 : null);
  }
  return out;
}

export function isStaleExtraction(v: { status: string; extractStartedAt: Date | null; extractAttempts: number }, now: Date): boolean {
  if (v.status !== "EXTRACTING" || v.extractAttempts >= MAX_EXTRACT_ATTEMPTS) return false;
  return !v.extractStartedAt || now.getTime() - v.extractStartedAt.getTime() > STALE_EXTRACT_MS;
}
