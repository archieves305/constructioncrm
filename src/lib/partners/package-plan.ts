import type { DocumentConfidentiality, RequirementStatus } from "@/generated/prisma/enums";
import type { DayKey } from "@/lib/time/zone";
import { daysUntil, docDay } from "./qualification-state";

/**
 * What goes into a prequalification package for one GC, decided from the
 * checklist and the vault. Pure: the loader supplies the documents, this says
 * which file answers each line — or why none does.
 *
 * A document goes out only when a manager approved it for external
 * distribution, it is in date, its file is on disk, and — if it is
 * RESTRICTED — the person assembling may open it and asked for restricted
 * documents. For each line the vault's current version is preferred; an older
 * version attached to the line is the fallback, and the contents sheet says so.
 */

export type PackageDoc = {
  id: string;
  title: string;
  version: number;
  fileName: string;
  confidentiality: DocumentConfidentiality;
  approvedForExternal: boolean;
  expiresAt: Date | string | null;
  missing: boolean;
};

export type PackageLine = {
  requirementId: string;
  typeName: string;
  required: boolean;
  status: RequirementStatus;
  attached: PackageDoc | null;
  current: PackageDoc | null;
};

export type PackageOptions = { today: DayKey; canReadRestricted: boolean; includeRestricted: boolean };

export type PackageItem = {
  requirementId: string;
  typeName: string;
  required: boolean;
  doc: PackageDoc | null;
  included: boolean;
  /** Why it was left out. */
  reason: string | null;
  /** Something the reader of the contents sheet should know (an older version, a version not attached). */
  note: string | null;
  restricted: boolean;
};

export type PackagePlan = { items: PackageItem[]; included: number; leftOut: number; requiredMissing: number; restrictedWithheld: number };

function refusal(d: PackageDoc, o: PackageOptions): { reason: string; restrictedWithheld: boolean } | null {
  const left = daysUntil(d.expiresAt, o.today);
  if (left !== null && left < 0) return { reason: `expired ${docDay(d.expiresAt!)}`, restrictedWithheld: false };
  if (!d.approvedForExternal) return { reason: "not approved for sending to a GC (a manager approves it in the vault)", restrictedWithheld: false };
  if (d.confidentiality === "RESTRICTED") {
    if (!o.canReadRestricted) return { reason: "restricted — only an admin or someone with the grant can include it", restrictedWithheld: true };
    if (!o.includeRestricted) return { reason: "restricted — tick “include restricted documents” to send it", restrictedWithheld: true };
  }
  if (d.missing) return { reason: "the file is missing from storage — upload it again in the vault", restrictedWithheld: false };
  return null;
}

export function planPackage(lines: readonly PackageLine[], o: PackageOptions): PackagePlan {
  let restrictedWithheld = 0;
  const items = lines.map((l): PackageItem => {
    const base = { requirementId: l.requirementId, typeName: l.typeName, required: l.required };
    if (l.status === "WAIVED") return { ...base, doc: null, included: false, reason: "waived by the GC", note: null, restricted: false };
    const candidates: { doc: PackageDoc; note: string | null }[] = [];
    if (l.current && (!l.attached || l.current.id !== l.attached.id)) {
      candidates.push({ doc: l.current, note: l.attached ? `v${l.current.version} sent; v${l.attached.version} is attached to the checklist` : "not attached to the checklist; the vault's current version is sent" });
    }
    if (l.attached) candidates.push({ doc: l.attached, note: l.current && l.current.id !== l.attached.id ? `older v${l.attached.version} sent (the current v${l.current.version} cannot go out)` : null });
    if (candidates.length === 0) return { ...base, doc: null, included: false, reason: "nothing in the vault for it yet", note: null, restricted: false };
    for (const c of candidates) {
      if (!refusal(c.doc, o)) {
        if (l.status === "REJECTED" && c.doc.id === l.attached?.id) continue;
        return { ...base, doc: c.doc, included: true, reason: null, note: c.note, restricted: c.doc.confidentiality === "RESTRICTED" };
      }
    }
    // Nothing can go: report the reason for the best candidate (the current version).
    const first = candidates[0];
    const why = refusal(first.doc, o);
    if (why?.restrictedWithheld) restrictedWithheld += 1;
    const reason = why?.reason ?? (l.status === "REJECTED" ? "the GC rejected the attached version — file a new one" : "cannot be sent");
    return { ...base, doc: first.doc, included: false, reason, note: null, restricted: first.doc.confidentiality === "RESTRICTED" };
  });
  const included = items.filter((i) => i.included).length;
  return { items, included, leftOut: items.length - included, requiredMissing: items.filter((i) => i.required && !i.included && i.reason !== "waived by the GC").length, restrictedWithheld };
}

/** A file name safe in every zip reader: no path separators, no control characters, bounded. */
export function safeName(s: string, max = 80): string {
  const cleaned = s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "document").slice(0, max).trim();
}

/** "03 - General liability COI - coi-2026.pdf", numbered in checklist order. */
export function entryName(index: number, typeName: string, fileName: string): string {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).slice(0, 10) : "";
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  return `${String(index).padStart(2, "0")} - ${safeName(typeName, 60)} - ${safeName(stem, 60)}${safeName(ext, 10)}`;
}

/** "GL COI v2" — the vault's default titles already end with the version; never say it twice. */
export function docLabel(title: string, version: number): string {
  return new RegExp(`\\bv${version}$`).test(title.trim()) ? title.trim() : `${title.trim()} v${version}`;
}

/** The contents sheet that leads the zip: what is in it, what is not and why. */
export function contentsSheet(plan: PackagePlan, meta: { companyName: string; organizationName: string; platform: string | null; preparedBy: string; preparedOn: DayKey }): string {
  const lines: string[] = [];
  lines.push(`${meta.companyName} — prequalification documents for ${meta.organizationName}${meta.platform ? ` (${meta.platform})` : ""}`);
  lines.push(`Prepared ${meta.preparedOn} by ${meta.preparedBy}.`);
  lines.push("");
  lines.push("Enclosed:");
  let n = 0;
  for (const i of plan.items) {
    if (!i.included || !i.doc) continue;
    n += 1;
    const exp = i.doc.expiresAt ? ` (valid to ${docDay(i.doc.expiresAt)})` : "";
    lines.push(`  ${String(n).padStart(2, "0")}. ${i.typeName} — ${docLabel(i.doc.title, i.doc.version)}${exp}`);
  }
  if (n === 0) lines.push("  (none)");
  const out = plan.items.filter((i) => !i.included && i.reason !== "waived by the GC");
  if (out.length) {
    lines.push("");
    lines.push("To follow:");
    for (const i of out) lines.push(`  - ${i.typeName}${i.required ? "" : " (optional)"}`);
  }
  lines.push("");
  return lines.join("\r\n");
}
