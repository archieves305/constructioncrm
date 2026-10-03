/**
 * A vendor's compliance, derived from its documents on read — never stored.
 *
 * Pure and client-safe. A subcontractor needs three things on file: a general
 * liability certificate, workers' comp (a certificate or an exemption), and a
 * W-9. A license is tracked with its expiry when one is recorded but is not a
 * requirement. Suppliers and other vendors need nothing; a dated document they
 * do carry is still watched.
 *
 * The most recently filed document of a requirement is the one in force. A gap
 * warns and raises a task; it never blocks anything.
 */

export type VendorKindName = "SUBCONTRACTOR" | "SUPPLIER" | "OTHER";
export type VendorDocType = "GL_INSURANCE" | "WORKERS_COMP" | "WC_EXEMPTION" | "W9" | "LICENSE" | "OTHER";
export type DayKey = string;

export const EXPIRING_WITHIN_DAYS = 30;

export const DOC_TYPE_LABEL: Record<VendorDocType, string> = {
  GL_INSURANCE: "General liability certificate",
  WORKERS_COMP: "Workers' comp certificate",
  WC_EXEMPTION: "Workers' comp exemption",
  W9: "W-9",
  LICENSE: "License",
  OTHER: "Other document",
};

export type RequirementKey = "liability" | "workers_comp" | "w9" | "license";

export const REQUIREMENT_LABEL: Record<RequirementKey, string> = {
  liability: "General liability",
  workers_comp: "Workers' comp",
  w9: "W-9",
  license: "License",
};

/** Which document types satisfy each requirement. */
export const REQUIREMENT_TYPES: Record<RequirementKey, readonly VendorDocType[]> = {
  liability: ["GL_INSURANCE"],
  workers_comp: ["WORKERS_COMP", "WC_EXEMPTION"],
  w9: ["W9"],
  license: ["LICENSE"],
};

const REQUIREMENTS: readonly RequirementKey[] = ["liability", "workers_comp", "w9", "license"];
/** What a subcontractor must have on file. */
const REQUIRED_OF_SUBCONTRACTOR: readonly RequirementKey[] = ["liability", "workers_comp", "w9"];
/** Requirements whose document runs out. A W-9 does not. */
const DATED: readonly RequirementKey[] = ["liability", "workers_comp", "license"];

export type ComplianceStatus = "ok" | "expiring" | "expired" | "missing" | "not_recorded";
export type ComplianceVerdict = "ok" | "expiring" | "missing" | "expired" | "not_required";

export type ComplianceDoc = {
  id: string;
  type: VendorDocType;
  expiresAt: Date | string | null;
  createdAt: Date | string;
};

export type RequirementState = {
  key: RequirementKey;
  label: string;
  required: boolean;
  status: ComplianceStatus;
  /** The document in force, when there is one. */
  docId: string | null;
  docType: VendorDocType | null;
  expiresDay: DayKey | null;
  /** Days until it expires; negative once it has. Null when undated. */
  daysLeft: number | null;
};

export type Compliance = {
  verdict: ComplianceVerdict;
  requirements: RequirementState[];
  /** Plain-words gaps, worst first: "General liability expired Sep 30", "W-9 missing". */
  gaps: string[];
};

/** Document dates are stored as a day pinned at noon UTC, so the UTC date is the day. */
export function docDay(d: Date | string): DayKey {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
}

function diffDays(a: DayKey, b: DayKey): number {
  return Math.round((Date.parse(`${b}T12:00:00.000Z`) - Date.parse(`${a}T12:00:00.000Z`)) / 86_400_000);
}

function shortDay(k: DayKey): string {
  return new Date(`${k}T12:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const time = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();

/** The document in force for a requirement: the most recently filed of its types. */
export function docInForce<D extends ComplianceDoc>(key: RequirementKey, docs: readonly D[]): D | null {
  const types = REQUIREMENT_TYPES[key];
  let best: D | null = null;
  for (const d of docs) {
    if (!types.includes(d.type)) continue;
    if (!best || time(d.createdAt) > time(best.createdAt)) best = d;
  }
  return best;
}

export function isRequired(kind: VendorKindName, key: RequirementKey): boolean {
  return kind === "SUBCONTRACTOR" && REQUIRED_OF_SUBCONTRACTOR.includes(key);
}

const SEVERITY: Record<ComplianceStatus, number> = { expired: 4, missing: 3, expiring: 2, ok: 1, not_recorded: 0 };

export function deriveCompliance(kind: VendorKindName, docs: readonly ComplianceDoc[], today: DayKey): Compliance {
  const requirements: RequirementState[] = REQUIREMENTS.map((key) => {
    const required = isRequired(kind, key);
    const doc = docInForce(key, docs);
    const base = { key, label: REQUIREMENT_LABEL[key], required };
    if (!doc) return { ...base, status: required ? "missing" : "not_recorded", docId: null, docType: null, expiresDay: null, daysLeft: null };
    const dated = DATED.includes(key) && doc.expiresAt;
    const expiresDay = dated ? docDay(doc.expiresAt as Date | string) : null;
    const daysLeft = expiresDay ? diffDays(today, expiresDay) : null;
    const status: ComplianceStatus = daysLeft === null ? "ok" : daysLeft < 0 ? "expired" : daysLeft <= EXPIRING_WITHIN_DAYS ? "expiring" : "ok";
    return { ...base, status, docId: doc.id, docType: doc.type, expiresDay, daysLeft };
  });

  const counted = requirements.filter((r) => r.status !== "not_recorded");
  const worst = counted.reduce<ComplianceStatus>((w, r) => (SEVERITY[r.status] > SEVERITY[w] ? r.status : w), "not_recorded");
  const verdict: ComplianceVerdict =
    worst === "not_recorded" ? (kind === "SUBCONTRACTOR" ? "ok" : "not_required") : worst === "ok" && kind !== "SUBCONTRACTOR" ? "not_required" : (worst as ComplianceVerdict);

  const gaps = counted
    .filter((r) => r.status !== "ok")
    .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status])
    .map((r) =>
      r.status === "missing"
        ? `${r.label} missing`
        : r.status === "expired"
          ? `${r.label} expired ${shortDay(r.expiresDay as DayKey)}`
          : `${r.label} expires ${shortDay(r.expiresDay as DayKey)}`,
    );
  return { verdict, requirements, gaps };
}

/** Does this verdict call for a warning where the vendor is used? */
export function needsAttention(verdict: ComplianceVerdict): boolean {
  return verdict === "expired" || verdict === "missing" || verdict === "expiring";
}

export const VERDICT_LABEL: Record<ComplianceVerdict, string> = {
  ok: "Compliant",
  expiring: "Expiring soon",
  missing: "Documents missing",
  expired: "Expired",
  not_required: "Not required",
};
