import type { CodeViolationStatus, Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { parseDueAt } from "@/lib/tasks/dates";
import { reassignUnresolved } from "@/lib/workflows/roles";
import type { UpdateCaseBody } from "@/lib/validators/violation";
import { auditCase } from "./audit";
import { ViolationError } from "./errors";
import { recordCaseEvent } from "./events";
import { syncCorrectiveWorkFromJob } from "./job-sync";
import { allowedTransitions, transitionNeedsReason } from "./rules";

type Actor = { id: string; role: RoleName };
const d = (v: string | null | undefined): Date | null => (v ? parseDueAt(v) : null);

const DATE_FIELDS = new Set(["receivedAt", "noticeDate", "originalDeadline", "appealDeadline"]);

/** Header edits. The current deadline is NOT editable here — it moves through the deadline-change path. */
export async function updateCase(id: string, body: UpdateCaseBody, actor: Actor) {
  const before = await prisma.codeViolationCase.findUnique({ where: { id } });
  if (!before) throw new ViolationError(404, "Case not found");
  const data: Prisma.CodeViolationCaseUncheckedUpdateInput = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    const key = k as keyof UpdateCaseBody;
    const next = DATE_FIELDS.has(key) ? d(v as string | null) : v;
    const prev = (before as unknown as Record<string, unknown>)[key];
    const same = prev instanceof Date && next instanceof Date ? prev.getTime() === next.getTime() : String(prev ?? "") === String(next ?? "");
    if (same) continue;
    (data as Record<string, unknown>)[key] = next;
    changed[key] = { from: prev instanceof Date ? prev.toISOString() : (prev ?? null), to: next instanceof Date ? next.toISOString() : (next ?? null) };
  }
  // The first deadline entered after intake seeds the current one too.
  if (data.originalDeadline !== undefined && !before.currentDeadline && data.originalDeadline) {
    data.currentDeadline = data.originalDeadline;
  }
  if (Object.keys(changed).length === 0) return before;

  const updated = await prisma.codeViolationCase.update({ where: { id }, data });
  if (changed.caseManagerId) {
    await recordCaseEvent(prisma, { caseId: id, actorUserId: actor.id, type: "ASSIGNED", fromValue: before.caseManagerId, toValue: updated.caseManagerId });
    await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: id, action: "violation_assign", before: { caseManagerId: before.caseManagerId }, after: { caseManagerId: updated.caseManagerId } });
    const inst = await prisma.jobWorkflowInstance.findUnique({ where: { violationCaseId: id }, select: { id: true } });
    if (inst) await reassignUnresolved(inst.id, actor.id);
  }
  const rest = Object.fromEntries(Object.entries(changed).filter(([k]) => k !== "caseManagerId"));
  if (Object.keys(rest).length > 0) {
    await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: id, action: "violation_case_update", before: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.from])), after: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.to])) });
  }
  return updated;
}

export async function assignCases(caseIds: string[], caseManagerId: string | null, actor: Actor): Promise<number> {
  if (caseManagerId) {
    const u = await prisma.user.findUnique({ where: { id: caseManagerId }, select: { isActive: true } });
    if (!u?.isActive) throw new ViolationError(400, "That user is not active");
  }
  let n = 0;
  for (const id of caseIds) {
    const before = await prisma.codeViolationCase.findUnique({ where: { id }, select: { caseManagerId: true } });
    if (!before || before.caseManagerId === caseManagerId) continue;
    await prisma.codeViolationCase.update({ where: { id }, data: { caseManagerId } });
    await recordCaseEvent(prisma, { caseId: id, actorUserId: actor.id, type: "ASSIGNED", fromValue: before.caseManagerId, toValue: caseManagerId });
    await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: id, action: "violation_assign", before, after: { caseManagerId } });
    const inst = await prisma.jobWorkflowInstance.findUnique({ where: { violationCaseId: id }, select: { id: true } });
    if (inst) await reassignUnresolved(inst.id, actor.id);
    n++;
  }
  return n;
}

export async function changeStatus(id: string, to: CodeViolationStatus, reason: string | null, actor: Actor) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id }, select: { status: true } });
  if (!c) throw new ViolationError(404, "Case not found");
  if (!allowedTransitions(c.status).includes(to)) throw new ViolationError(400, `A ${c.status.toLowerCase().replace("_", " ")} case cannot move to ${to.toLowerCase().replace("_", " ")} this way`);
  if (transitionNeedsReason(to) && !reason?.trim()) throw new ViolationError(400, "Say why");
  const updated = await prisma.codeViolationCase.update({ where: { id }, data: { status: to } });
  await recordCaseEvent(prisma, { caseId: id, actorUserId: actor.id, type: "STATUS_CHANGED", fromValue: c.status, toValue: to, body: reason?.trim() || null });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: id, action: "violation_status_change", before: { status: c.status }, after: { status: to }, reason: reason?.trim() || null });
  return updated;
}

export async function linkJob(id: string, jobId: string, actor: Actor) {
  const [c, job] = await Promise.all([
    prisma.codeViolationCase.findUnique({ where: { id }, select: { leadId: true, jobId: true } }),
    prisma.job.findUnique({ where: { id: jobId }, select: { id: true, leadId: true, jobNumber: true } }),
  ]);
  if (!c) throw new ViolationError(404, "Case not found");
  if (!job) throw new ViolationError(404, "Job not found");
  if (job.leadId !== c.leadId) throw new ViolationError(400, "The job belongs to a different property");
  if (c.jobId === jobId) return;
  await prisma.codeViolationCase.update({ where: { id }, data: { jobId } });
  await recordCaseEvent(prisma, { caseId: id, actorUserId: actor.id, type: "JOB_LINKED", fromValue: c.jobId, toValue: jobId, body: job.jobNumber });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: id, action: "violation_job_linked", before: { jobId: c.jobId }, after: { jobId } });
  await syncCorrectiveWorkFromJob(id, actor.id);
}

export async function unlinkJob(id: string, actor: Actor) {
  const c = await prisma.codeViolationCase.findUnique({ where: { id }, select: { jobId: true, job: { select: { jobNumber: true } } } });
  if (!c) throw new ViolationError(404, "Case not found");
  if (!c.jobId) return;
  await prisma.codeViolationCase.update({ where: { id }, data: { jobId: null } });
  await recordCaseEvent(prisma, { caseId: id, actorUserId: actor.id, type: "JOB_UNLINKED", fromValue: c.jobId, body: c.job?.jobNumber ?? null });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: id, action: "violation_job_unlinked", before: { jobId: c.jobId }, after: { jobId: null } });
}
