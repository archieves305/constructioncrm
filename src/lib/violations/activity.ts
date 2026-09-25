import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * The Activity tab: the case timeline, plus — for ADMIN/MANAGER — the audit
 * rows for the case and every child record, merged newest first.
 */
export async function readActivity(caseId: string, user: { id: string; role: RoleName }) {
  const events = await prisma.codeViolationEvent.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    include: { actor: { select: { id: true, firstName: true, lastName: true } } },
    take: 500,
  });
  let audit: { id: string; action: string; entityType: string; entityId: string; actor: { id: string; firstName: string; lastName: string } | null; beforeJson: unknown; afterJson: unknown; createdAt: Date }[] = [];
  if (user.role === "ADMIN" || user.role === "MANAGER") {
    const c = await prisma.codeViolationCase.findUnique({
      where: { id: caseId },
      select: { items: { select: { id: true } }, hearings: { select: { id: true } }, inspections: { select: { id: true } }, extensions: { select: { id: true } }, fineEntries: { select: { id: true } } },
    });
    const ids = [caseId, ...(c?.items ?? []).map((x) => x.id), ...(c?.hearings ?? []).map((x) => x.id), ...(c?.inspections ?? []).map((x) => x.id), ...(c?.extensions ?? []).map((x) => x.id), ...(c?.fineEntries ?? []).map((x) => x.id)];
    audit = await prisma.auditEvent.findMany({
      where: { entityId: { in: ids }, entityType: { startsWith: "CodeViolation" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, action: true, entityType: true, entityId: true, beforeJson: true, afterJson: true, createdAt: true, actor: { select: { id: true, firstName: true, lastName: true } } },
      take: 500,
    });
  }
  return { events, audit };
}
