import { z } from "zod";
import { addDayKeys, dayKey, type DayKey } from "@/lib/time/zone";

/**
 * Product approvals without the database. Pure and client-safe.
 *
 * A Florida Product Approval or a Miami-Dade NOA is read by the AI into
 * fields, each with the page and quote it came from (`extractionSchema`);
 * the mapping trusts none of it unchecked. The checks against a permit are
 * advisory: they point at what an engineer or the building official should
 * look at, and never say a product is or is not acceptable.
 */
export const ADVISORY = "Advisory — not an engineering determination. The engineer of record and the building official decide.";

export const AUTHORITIES = ["FL_PRODUCT_APPROVAL", "MIAMI_DADE_NOA", "OTHER"] as const;
export const CATEGORIES = ["UNDERLAYMENT", "ROOF_COVERING", "ROOF_ASSEMBLY", "WINDOW", "EXTERIOR_DOOR", "GARAGE_DOOR", "SHUTTER", "SKYLIGHT", "OTHER"] as const;
export type Authority = (typeof AUTHORITIES)[number];
export type Category = (typeof CATEGORIES)[number];

export const AUTHORITY_LABEL: Record<Authority, string> = { FL_PRODUCT_APPROVAL: "Florida Product Approval", MIAMI_DADE_NOA: "Miami-Dade NOA", OTHER: "Other approval" };
export const CATEGORY_LABEL: Record<Category, string> = {
  UNDERLAYMENT: "Underlayment",
  ROOF_COVERING: "Roof covering",
  ROOF_ASSEMBLY: "Roof assembly",
  WINDOW: "Window",
  EXTERIOR_DOOR: "Exterior door",
  GARAGE_DOOR: "Garage door",
  SHUTTER: "Shutter",
  SKYLIGHT: "Skylight",
  OTHER: "Other",
};

/** The fields a person checks, in the order they are shown. */
export const APPROVAL_FIELDS = ["authority", "approvalNumber", "revision", "manufacturer", "productName", "models", "category", "hvhzApproved", "nonHvhzApproved", "designPressurePos", "designPressureNeg", "impactRated", "issuedAt", "expiresAt", "limitations", "configurations"] as const;
export type ApprovalField = (typeof APPROVAL_FIELDS)[number];

const day = z.string().nullable().describe("YYYY-MM-DD, or null when the document does not state it.");

export const extractionSchema = z.object({
  isApproval: z.boolean().describe("False when the document is not a product approval, NOA or evaluation report."),
  authority: z.enum(AUTHORITIES),
  approvalNumber: z.string().nullable().describe('As printed, without the revision: "FL11842.3", "26-0504.06".'),
  revision: z.string().nullable().describe('"R9" for a Florida approval; null for an NOA.'),
  manufacturer: z.string().nullable(),
  productName: z.string().nullable(),
  models: z.array(z.string()).describe("Model or product names the approval covers, as printed."),
  category: z.enum(CATEGORIES),
  hvhzApproved: z.boolean().nullable().describe("True only when the document says the product is approved for the High Velocity Hurricane Zone; false when it says it is not; null when silent."),
  nonHvhzApproved: z.boolean().nullable(),
  designPressurePos: z.number().nullable().describe("The product's own positive design pressure in psf, if stated. Not a test or uplift value of another product."),
  designPressureNeg: z.number().nullable().describe("The product's own negative (uplift) design pressure in psf, as a negative number, if stated."),
  impactRated: z.boolean().nullable(),
  limitations: z.string().nullable().describe("The limitations and conditions of use, condensed to the essentials but in the document's terms."),
  configurations: z.array(z.object({ deck: z.string().nullable(), slope: z.string().nullable(), underlayment: z.string().nullable(), fastening: z.string().nullable(), maxDesignPressure: z.string().nullable() })).describe("For roofing: the approved assemblies or systems, one per row, as the document lists them."),
  issuedAt: day,
  expiresAt: day,
  evidence: z.array(z.object({ field: z.string(), page: z.number().int(), quote: z.string() })).describe("For each field you filled, the page (1-based) and a short exact quote from the document that shows it."),
});
export type Extraction = z.infer<typeof extractionSchema>;

const tidy = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** A YYYY-MM-DD the model read, kept only when it is a real day between 1990 and 2100. */
export function readDay(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  const y = d.getUTCFullYear();
  return y >= 1990 && y <= 2100 ? d : null;
}

/** A pressure in psf: a number in a range a building product states; the uplift always negative. */
export function readPressure(v: number | null, sign: 1 | -1): number | null {
  if (v == null || !Number.isFinite(v) || v === 0 || Math.abs(v) > 500) return null;
  return Math.round(Math.abs(v) * 100) / 100 * sign;
}

export type ApprovalData = {
  authority: Authority;
  approvalNumber: string | null;
  revision: string | null;
  manufacturer: string | null;
  productName: string | null;
  models: string[];
  category: Category;
  hvhzApproved: boolean | null;
  nonHvhzApproved: boolean | null;
  designPressurePos: number | null;
  designPressureNeg: number | null;
  impactRated: boolean | null;
  limitations: string | null;
  configurations: Extraction["configurations"];
  issuedAt: Date | null;
  expiresAt: Date | null;
  evidence: Record<string, { page: number; quote: string }>;
};

/** The model's reading as fields to store. Anything it could not back is cleared, not trusted. */
export function approvalFromExtraction(out: Extraction, pageCount: number | null): ApprovalData {
  const evidence: ApprovalData["evidence"] = {};
  for (const e of out.evidence) {
    if (!(APPROVAL_FIELDS as readonly string[]).includes(e.field) || evidence[e.field]) continue;
    if (!Number.isInteger(e.page) || e.page < 1 || (pageCount != null && e.page > pageCount)) continue;
    const quote = tidy(e.quote, 300);
    if (quote) evidence[e.field] = { page: e.page, quote };
  }
  const issuedAt = readDay(out.issuedAt);
  let expiresAt = readDay(out.expiresAt);
  if (issuedAt && expiresAt && expiresAt <= issuedAt) expiresAt = null;
  return {
    authority: out.authority,
    approvalNumber: tidy(out.approvalNumber, 60),
    revision: tidy(out.revision, 20),
    manufacturer: tidy(out.manufacturer, 200),
    productName: tidy(out.productName, 200),
    models: [...new Set(out.models.map((m) => tidy(m, 120)).filter((m): m is string => !!m))].slice(0, 50),
    category: out.category,
    hvhzApproved: out.hvhzApproved,
    nonHvhzApproved: out.nonHvhzApproved,
    designPressurePos: readPressure(out.designPressurePos, 1),
    designPressureNeg: readPressure(out.designPressureNeg, -1),
    impactRated: out.impactRated,
    limitations: tidy(out.limitations, 6000),
    configurations: out.configurations.slice(0, 60).map((c) => ({ deck: tidy(c.deck, 200), slope: tidy(c.slope, 80), underlayment: tidy(c.underlayment, 200), fastening: tidy(c.fastening, 300), maxDesignPressure: tidy(c.maxDesignPressure, 80) })),
    issuedAt,
    expiresAt,
    evidence,
  };
}

/** "FL 11842.3" and "fl11842.3" are the same approval: the comparable form of a number. */
export function normalizeNumber(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

// ─── Checks against a permit ────────────────────────────────────────────────

export type Flag = { code: string; level: "danger" | "warning" | "info"; message: string };

export type CheckInput = {
  approval: { readState: string; hvhzApproved: boolean | null; designPressurePos: number | null; designPressureNeg: number | null; expiresAt: Date | null; isActive: boolean; authority: Authority };
  use: { requiredPressurePos: number | null; requiredPressureNeg: number | null };
  permit: { hvhz: boolean; expectedApprovalDate: Date | null };
  inPackage: boolean;
  today: Date;
};

/** What a person should look at before this product goes in the package. Advisory, every one. */
export function checkProduct(c: CheckInput): Flag[] {
  const out: Flag[] = [];
  const a = c.approval;
  const todayKey = dayKey(c.today);
  if (!a.isActive) out.push({ code: "inactive", level: "warning", message: "This approval was set aside in the repository" });
  if (a.readState !== "VERIFIED") out.push({ code: "unverified", level: "warning", message: "Its fields have not been checked against the document by a person" });
  if (a.expiresAt) {
    const exp = dayKey(a.expiresAt);
    if (exp < todayKey) out.push({ code: "expired", level: "danger", message: `Expired on ${exp}` });
    else if (c.permit.expectedApprovalDate && exp < dayKey(c.permit.expectedApprovalDate)) out.push({ code: "expires-before-approval", level: "warning", message: `Expires ${exp}, before the permit's expected approval` });
    else if (exp <= addDayKeys(todayKey, 30)) out.push({ code: "expiring", level: "warning", message: `Expires ${exp}, within 30 days` });
  } else if (a.authority === "MIAMI_DADE_NOA") {
    out.push({ code: "no-expiry", level: "info", message: "No expiration date recorded — an NOA states one on its first page" });
  }
  if (c.permit.hvhz && a.hvhzApproved !== true) out.push({ code: "hvhz", level: "danger", message: a.hvhzApproved === false ? "The jurisdiction is in the HVHZ and the approval says it is not for the HVHZ" : "The jurisdiction is in the HVHZ and the approval does not say it is for the HVHZ" });
  const pos = c.use.requiredPressurePos;
  const neg = c.use.requiredPressureNeg;
  if (pos != null) {
    if (a.designPressurePos == null) out.push({ code: "pressure-unknown", level: "info", message: `${pos} psf is required and the approval states no positive design pressure` });
    else if (Math.abs(pos) > Math.abs(a.designPressurePos)) out.push({ code: "pressure-pos", level: "danger", message: `${pos} psf is required; the approval states +${Math.abs(a.designPressurePos)} psf` });
  }
  if (neg != null) {
    if (a.designPressureNeg == null) out.push({ code: "pressure-unknown-neg", level: "info", message: `${-Math.abs(neg)} psf is required and the approval states no negative design pressure` });
    else if (Math.abs(neg) > Math.abs(a.designPressureNeg)) out.push({ code: "pressure-neg", level: "danger", message: `${-Math.abs(neg)} psf is required; the approval states ${-Math.abs(a.designPressureNeg)} psf` });
  }
  if (!c.inPackage) out.push({ code: "not-in-documents", level: "info", message: "The approval document is not among the permit's documents yet" });
  return out;
}

// ─── Expiry tasks ───────────────────────────────────────────────────────────

/** Raised 30 days ahead, due 14 days ahead; once per approval, permit and expiry date. */
export const EXPIRY_NOTICE_DAYS = 30;

export const approvalAlertKey = (approvalId: string, permitId: string, expiry: DayKey) => `approval:${approvalId}:${permitId}:expiring@${expiry}`;

export function approvalAlert(a: { id: string; expiresAt: Date | null; label: string }, permitId: string, today: Date): { sourceKey: string; dueDay: DayKey; title: string; priority: "HIGH" | "URGENT" } | null {
  if (!a.expiresAt) return null;
  const exp = dayKey(a.expiresAt);
  const now = dayKey(today);
  if (exp > addDayKeys(now, EXPIRY_NOTICE_DAYS)) return null;
  const lapsed = exp < now;
  const due = addDayKeys(exp, -14) < now ? now : addDayKeys(exp, -14);
  return { sourceKey: approvalAlertKey(a.id, permitId, exp), dueDay: due, title: lapsed ? `Product approval expired: ${a.label}` : `Product approval expires ${exp}: ${a.label}`, priority: lapsed ? "URGENT" : "HIGH" };
}
