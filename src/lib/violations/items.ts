import type { CodeViolationItemStatus, Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { parseDueAt } from "@/lib/tasks/dates";
import { auditCase } from "./audit";
import { ViolationError } from "./errors";
import { recordCaseEvent } from "./events";

type Actor = { id: string; role: RoleName };
const d = (v: string | null | undefined): Date | null => (v ? parseDueAt(v) : null);

const ITEM_INCLUDE = { category: { select: { id: true, key: true, name: true } }, assignedTo: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { tasks: true, files: true } } } as const;

export async function addItem(caseId: string, body: Record<string, unknown>, actor: Actor) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { id: true, status: true, _count: { select: { items: true } } } });
  if (!c) throw new ViolationError(404, "Case not found");
  if (c.status === "CLOSED" || c.status === "CANCELLED") throw new ViolationError(409, "This case is closed");
  const last = await prisma.codeViolationItem.aggregate({ where: { caseId }, _max: { itemNumber: true } });
  const itemNumber = (last._max.itemNumber ?? 0) + 1;
  const b = body as { categoryId?: string | null; codeSection?: string | null; description: string; correctiveAction?: string | null; responsibleTrade?: string | null; permitRequirement?: "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED"; assignedUserId?: string | null; assignedRole?: Prisma.CodeViolationItemCreateInput["assignedRole"]; contractorName?: string | null; targetCompletionAt?: string | null; estimatedCost?: string | null };
  const row = await prisma.codeViolationItem.create({
    data: {
      caseId,
      itemNumber,
      categoryId: b.categoryId ?? null,
      codeSection: b.codeSection ?? null,
      description: b.description,
      correctiveAction: b.correctiveAction ?? null,
      responsibleTrade: b.responsibleTrade ?? null,
      permitRequirement: b.permitRequirement ?? "UNDETERMINED",
      assignedUserId: b.assignedUserId ?? null,
      assignedRole: b.assignedRole ?? null,
      contractorName: b.contractorName ?? null,
      targetCompletionAt: d(b.targetCompletionAt),
      estimatedCost: b.estimatedCost ?? null,
      sortOrder: itemNumber * 10,
    },
    include: ITEM_INCLUDE,
  });
  await recordCaseEvent(prisma, { caseId, itemId: row.id, actorUserId: actor.id, type: "ITEM_ADDED", body: `Item ${itemNumber}: ${b.description.slice(0, 120)}` });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationItem", entityId: row.id, action: "violation_item_add", after: { caseId, itemNumber, categoryId: b.categoryId ?? null, description: b.description } });
  return row;
}

export async function updateItem(caseId: string, itemId: string, body: Record<string, unknown>, actor: Actor) {
  const before = await prisma.codeViolationItem.findUnique({ where: { id: itemId } });
  if (!before || before.caseId !== caseId) throw new ViolationError(404, "Item not found");
  const b = body as Partial<{ categoryId: string | null; codeSection: string | null; description: string; correctiveAction: string | null; responsibleTrade: string | null; permitRequirement: "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED"; assignedUserId: string | null; assignedRole: Prisma.CodeViolationItemUpdateInput["assignedRole"]; contractorName: string | null; targetCompletionAt: string | null; estimatedCost: string | null; status: CodeViolationItemStatus; actualCompletionAt: string | null; actualCost: string | null }>;
  const data: Prisma.CodeViolationItemUncheckedUpdateInput = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    const next = k === "targetCompletionAt" || k === "actualCompletionAt" ? d(v as string | null) : v;
    const prev = (before as unknown as Record<string, unknown>)[k];
    const same = prev instanceof Date && next instanceof Date ? prev.getTime() === next.getTime() : String(prev ?? "") === String(next ?? "");
    if (same) continue;
    (data as Record<string, unknown>)[k] = next;
    changed[k] = { from: prev instanceof Date ? prev.toISOString() : (prev ?? null), to: next instanceof Date ? next.toISOString() : (next ?? null) };
  }
  if (Object.keys(changed).length === 0) return prisma.codeViolationItem.findUniqueOrThrow({ where: { id: itemId }, include: ITEM_INCLUDE });
  const now = new Date();
  if (b.status && b.status !== before.status) {
    if ((b.status === "CORRECTED" || b.status === "VERIFIED") && !before.actualCompletionAt && data.actualCompletionAt === undefined) data.actualCompletionAt = now;
    if (b.status === "VERIFIED") data.verifiedAt = now;
    if (b.status === "OPEN" || b.status === "IN_PROGRESS") data.verifiedAt = null;
  }
  const row = await prisma.codeViolationItem.update({ where: { id: itemId }, data, include: ITEM_INCLUDE });
  if (changed.status) {
    await recordCaseEvent(prisma, { caseId, itemId, actorUserId: actor.id, type: "ITEM_STATUS_CHANGED", fromValue: before.status, toValue: row.status, body: `Item ${before.itemNumber}` });
    await auditCase({ actorUserId: actor.id, entityType: "CodeViolationItem", entityId: itemId, action: "violation_item_status_change", before: { status: before.status }, after: { status: row.status, caseId } });
  }
  const rest = Object.fromEntries(Object.entries(changed).filter(([k]) => k !== "status"));
  if (Object.keys(rest).length > 0) {
    await auditCase({ actorUserId: actor.id, entityType: "CodeViolationItem", entityId: itemId, action: "violation_item_update", before: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.from])), after: { caseId, ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.to])) } });
  }
  return row;
}

export async function removeItem(caseId: string, itemId: string, actor: Actor) {
  const before = await prisma.codeViolationItem.findUnique({ where: { id: itemId }, select: { caseId: true, itemNumber: true, description: true, _count: { select: { tasks: true } } } });
  if (!before || before.caseId !== caseId) throw new ViolationError(404, "Item not found");
  if (before._count.tasks > 0) throw new ViolationError(409, "This item has tasks; withdraw it instead of deleting it");
  await prisma.codeViolationItem.delete({ where: { id: itemId } });
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "ITEM_STATUS_CHANGED", fromValue: "present", toValue: "deleted", body: `Item ${before.itemNumber} removed` });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationItem", entityId: itemId, action: "violation_item_delete", before: { caseId, itemNumber: before.itemNumber, description: before.description } });
}

/** Failed reinspection: the re-cited items go back to OPEN. */
export async function reopenItems(caseId: string, itemIds: string[], actor: Actor, why: string): Promise<number> {
  if (itemIds.length === 0) return 0;
  const rows = await prisma.codeViolationItem.findMany({ where: { caseId, id: { in: itemIds }, status: { in: ["CORRECTED", "VERIFIED", "IN_PROGRESS"] } }, select: { id: true, itemNumber: true, status: true } });
  for (const r of rows) {
    await prisma.codeViolationItem.update({ where: { id: r.id }, data: { status: "OPEN", verifiedAt: null, actualCompletionAt: null } });
    await recordCaseEvent(prisma, { caseId, itemId: r.id, actorUserId: actor.id, type: "ITEM_STATUS_CHANGED", fromValue: r.status, toValue: "OPEN", body: `Item ${r.itemNumber} — ${why}` });
  }
  return rows.length;
}

export async function verifyItems(caseId: string, itemIds: string[] | null, actor: Actor, why: string): Promise<number> {
  const rows = await prisma.codeViolationItem.findMany({ where: { caseId, ...(itemIds ? { id: { in: itemIds } } : {}), status: { notIn: ["VERIFIED", "WITHDRAWN"] } }, select: { id: true, itemNumber: true, status: true, actualCompletionAt: true } });
  const now = new Date();
  for (const r of rows) {
    await prisma.codeViolationItem.update({ where: { id: r.id }, data: { status: "VERIFIED", verifiedAt: now, actualCompletionAt: r.actualCompletionAt ?? now } });
    await recordCaseEvent(prisma, { caseId, itemId: r.id, actorUserId: actor.id, type: "ITEM_STATUS_CHANGED", fromValue: r.status, toValue: "VERIFIED", body: `Item ${r.itemNumber} — ${why}` });
  }
  return rows.length;
}
