import { prisma } from "@/lib/db/prisma";
import { todayKey, type DayKey } from "@/lib/time/zone";
import { deriveCompliance, needsAttention, type Compliance, type ComplianceVerdict } from "./compliance";

/** What a screen that uses a vendor needs to warn about it. */
export type ComplianceSummary = { verdict: ComplianceVerdict; gaps: string[] };

export const DOC_COMPLIANCE_SELECT = { id: true, type: true, expiresAt: true, createdAt: true } as const;

/** Compliance for a set of vendors in two queries. Vendors that do not exist are simply absent. */
export async function complianceForVendors(vendorIds: readonly string[], today: DayKey = todayKey()): Promise<Map<string, Compliance>> {
  const ids = [...new Set(vendorIds.filter(Boolean))];
  const out = new Map<string, Compliance>();
  if (ids.length === 0) return out;
  const vendors = await prisma.vendor.findMany({
    where: { id: { in: ids } },
    select: { id: true, kind: true, documents: { select: DOC_COMPLIANCE_SELECT } },
  });
  for (const v of vendors) out.set(v.id, deriveCompliance(v.kind, v.documents, today));
  return out;
}

export function summarise(c: Compliance | undefined): ComplianceSummary | null {
  return c ? { verdict: c.verdict, gaps: c.gaps } : null;
}

/**
 * Active subcontractors whose paperwork is not in order — the dashboard row.
 * One query; the count and the list both read this, so they always agree.
 */
export async function vendorsNeedingDocuments(today: DayKey = todayKey()) {
  const vendors = await prisma.vendor.findMany({
    where: { isActive: true, kind: "SUBCONTRACTOR" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, trade: true, kind: true, documents: { select: DOC_COMPLIANCE_SELECT } },
  });
  return vendors
    .map((v) => ({ id: v.id, name: v.name, trade: v.trade, compliance: deriveCompliance(v.kind, v.documents, today) }))
    .filter((v) => needsAttention(v.compliance.verdict));
}
