import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { parseDueAt } from "@/lib/tasks/dates";
import { updateTask } from "@/lib/tasks/update";
import { maybeCompleteInstance, sweepActivation } from "@/lib/workflows/activation";
import { recordTaskEvent } from "@/lib/tasks/events";
import { ENGINE_SKIP_PREFIX } from "@/lib/workflows/reconcile";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { auditCase } from "./audit";
import { ViolationError } from "./errors";
import { recordCaseEvent } from "./events";
import { closureBlockers, type ClosureBlocker } from "./rules";

type Actor = { id: string; role: RoleName };

export async function computeClosureBlockers(caseId: string): Promise<ClosureBlocker[]> {
  const c = await prisma.codeViolationCase.findUnique({
    where: { id: caseId },
    select: { agencyConfirmedAt: true, lienStatus: true, officialBalance: true, fineResolvedAt: true, items: { select: { status: true } }, workflow: { select: { id: true } } },
  });
  if (!c) throw new ViolationError(404, "Case not found");
  const openBlockingSteps = c.workflow ? await prisma.task.count({ where: { workflowInstanceId: c.workflow.id, workflowTaskKey: { not: null }, blocking: true, ...ACTIVE_OPEN_WHERE } }) : 0;
  return closureBlockers({ items: c.items, agencyConfirmedAt: c.agencyConfirmedAt, lienStatus: c.lienStatus, officialBalance: c.officialBalance === null ? null : Number(c.officialBalance), fineResolvedAt: c.fineResolvedAt, openBlockingSteps });
}

/**
 * Close a case. Every blocker must be clear, or an ADMIN/MANAGER supplies
 * an override reason (audited as its own action). Open workflow steps are
 * skipped with the engine prefix so reports classify them as engine skips,
 * and the instance completes.
 */
export async function closeCase(input: { caseId: string; actor: Actor; reason?: string | null; overrideReason?: string | null; source?: "manual" | "workflow" }) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: input.caseId }, select: { status: true, caseNumber: true, workflow: { select: { id: true } } } });
  if (!c) throw new ViolationError(404, "Case not found");
  if (c.status === "CLOSED") throw new ViolationError(409, "This case is already closed");
  const blockers = await computeClosureBlockers(input.caseId);
  const override = input.overrideReason?.trim() || null;
  if (blockers.length > 0 && !override) {
    throw new ViolationError(400, `This case cannot close yet: ${blockers.map((b) => b.message).join("; ")}`, { blockers });
  }
  const now = new Date();
  // Skip the open steps first, so the closing step itself (if this came from it) is untouched.
  let skipped = 0;
  if (c.workflow) {
    const open = await prisma.task.findMany({ where: { workflowInstanceId: c.workflow.id, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } }, select: { id: true } });
    for (const t of open) {
      try {
        await updateTask({ id: t.id, input: { status: "CANCELLED", skipReason: `${ENGINE_SKIP_PREFIX}case ${c.caseNumber} closed` }, actorUserId: input.actor.id, actorRole: input.actor.role, notify: "none", internal: { bypassGate: true } });
        skipped++;
      } catch {
        // A step that refuses to skip does not stop the closure; the instance status below still reflects it.
      }
    }
    await maybeCompleteInstance(c.workflow.id);
  }
  const updated = await prisma.codeViolationCase.update({
    where: { id: input.caseId },
    data: { status: "CLOSED", closedAt: now, closedByUserId: input.actor.id, closeReason: input.reason?.trim() || null, closureOverrideReason: blockers.length > 0 ? override : null },
  });
  await recordCaseEvent(prisma, { caseId: input.caseId, actorUserId: input.actor.id, type: "CLOSED", fromValue: c.status, toValue: "CLOSED", body: blockers.length > 0 ? `Closed past ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}: ${override}` : (input.reason?.trim() || null) });
  await auditCase({ actorUserId: input.actor.id, entityType: "CodeViolationCase", entityId: input.caseId, action: "violation_closed", before: { status: c.status }, after: { status: "CLOSED", closedAt: now.toISOString(), skippedTasks: skipped, source: input.source ?? "manual" }, reason: input.reason?.trim() || null });
  if (blockers.length > 0) {
    await auditCase({ actorUserId: input.actor.id, entityType: "CodeViolationCase", entityId: input.caseId, action: "violation_closure_override", after: { blockers: blockers.map((b) => b.key), actorRole: input.actor.role, source: input.source ?? "manual" }, reason: override });
  }
  return { case: updated, skippedTasks: skipped, overridden: blockers.length > 0 };
}

export async function reopenCase(caseId: string, reason: string, actor: Actor) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { status: true, agencyConfirmedAt: true, workflow: { select: { id: true } } } });
  if (!c) throw new ViolationError(404, "Case not found");
  if (c.status !== "CLOSED" && c.status !== "CANCELLED") throw new ViolationError(409, "This case is not closed");
  const to = c.agencyConfirmedAt ? "COMPLIED" : "ACTIVE";
  const updated = await prisma.codeViolationCase.update({ where: { id: caseId }, data: { status: to, closedAt: null, closedByUserId: null, closeReason: null, closureOverrideReason: null } });
  // Reverse the closure's engine skips: every step the close cancelled comes
  // back as Not active, and the activation sweep re-opens whatever its
  // predecessors allow. A person's own skips (no engine prefix) stay skipped.
  let reinstated = 0;
  if (c.workflow) {
    await prisma.jobWorkflowInstance.updateMany({ where: { id: c.workflow.id, status: "COMPLETED" }, data: { status: "ACTIVE" } });
    const skippedByClose = await prisma.task.findMany({
      where: { workflowInstanceId: c.workflow.id, status: "CANCELLED", skipReason: { startsWith: `${ENGINE_SKIP_PREFIX}case ` } },
      select: { id: true },
      orderBy: { workflowSortOrder: "asc" },
    });
    for (const t of skippedByClose) {
      await updateTask({ id: t.id, input: { status: "PENDING", skipReason: null }, actorUserId: actor.id, actorRole: actor.role, notify: "none" });
      await prisma.task.update({ where: { id: t.id }, data: { activatedAt: null } });
      await recordTaskEvent({ taskId: t.id, actorUserId: actor.id, type: "RECONCILED", body: `reinstated — case reopened` });
      reinstated++;
    }
    await sweepActivation(c.workflow.id, actor.id);
  }
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "REOPENED", fromValue: c.status, toValue: to, body: reason });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: caseId, action: "violation_reopened", before: { status: c.status }, after: { status: to, reinstatedTasks: reinstated }, reason });
  return updated;
}

/** The agency's written confirmation — the closure precondition. Never inferred from construction completion. */
export async function confirmAgency(
  caseId: string,
  body: { confirmedAt: string; confirmedByName?: string | null; method?: string | null; reference?: string | null; fileId?: string | null; officialComplianceDate?: string | null; notes?: string | null },
  actor: Actor,
  source: "manual" | "inspection" = "manual",
) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { status: true, agencyConfirmedAt: true } });
  if (!c) throw new ViolationError(404, "Case not found");
  const confirmedAt = parseDueAt(body.confirmedAt);
  const updated = await prisma.codeViolationCase.update({
    where: { id: caseId },
    data: {
      agencyConfirmedAt: confirmedAt,
      agencyConfirmedByName: body.confirmedByName ?? null,
      agencyConfirmationMethod: body.method ?? null,
      agencyConfirmationRef: body.reference ?? null,
      agencyConfirmationFileId: body.fileId ?? null,
      officialComplianceDate: body.officialComplianceDate ? parseDueAt(body.officialComplianceDate) : confirmedAt,
      ...(c.status === "ACTIVE" || c.status === "APPEALED" || c.status === "NEW" ? { status: "COMPLIED" } : {}),
    },
  });
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "AGENCY_CONFIRMED", toValue: confirmedAt.toISOString(), body: [body.confirmedByName, body.method, body.reference, body.notes].filter(Boolean).join(" · ") || null });
  if (updated.status !== c.status) await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "STATUS_CHANGED", fromValue: c.status, toValue: updated.status, body: "Agency confirmed compliance" });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: caseId, action: "violation_agency_confirmed", before: { agencyConfirmedAt: c.agencyConfirmedAt?.toISOString() ?? null, status: c.status }, after: { confirmedAt: confirmedAt.toISOString(), confirmedByName: body.confirmedByName ?? null, method: body.method ?? null, reference: body.reference ?? null, fileId: body.fileId ?? null, status: updated.status, source } });
  return updated;
}
