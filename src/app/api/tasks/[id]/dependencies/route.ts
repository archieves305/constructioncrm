import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { taskDependencySchema } from "@/lib/validators/workflow";
import { canEditDependencies } from "@/lib/workflows/access";
import { subjectScopeForTask } from "@/lib/workflows/visibility";
import { findCycle } from "@/lib/workflows/dependencies";
import { recordTaskEvent } from "@/lib/tasks/events";
import { recordAudit } from "@/lib/audit/record";
import { sweepActivation } from "@/lib/workflows/activation";

async function load(id: string) {
  return prisma.task.findUnique({ where: { id }, select: { id: true, jobId: true, violationCaseId: true, workflowInstanceId: true, status: true, activatedAt: true } });
}

/** Make this task wait on another step of the same workflow. 400 with the path on a cycle. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, taskDependencySchema);
  if (!parsed.ok) return parsed.response;
  const [task, other] = await Promise.all([load(id), load(parsed.data.dependsOnTaskId)]);
  if (!task || (!task.jobId && !task.violationCaseId)) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!other || other.workflowInstanceId !== task.workflowInstanceId || !task.workflowInstanceId) return badRequest("Both tasks must be steps in the same workflow");
  if (other.id === task.id) return badRequest("A task cannot wait on itself");
  const subjectScope = await subjectScopeForTask(task);
  if (!subjectScope || !canEditDependencies(session.user, subjectScope)) return forbidden();

  const edges = await prisma.taskDependency.findMany({
    where: { task: { workflowInstanceId: task.workflowInstanceId } },
    select: { taskId: true, dependsOnTaskId: true, kind: true },
  });
  const titles = await prisma.task.findMany({ where: { workflowInstanceId: task.workflowInstanceId }, select: { id: true, title: true } });
  const cycle = findCycle(
    titles.map((t) => t.id),
    [...edges.map((e) => ({ task: e.taskId, dependsOn: e.dependsOnTaskId, kind: e.kind })), { task: task.id, dependsOn: other.id, kind: parsed.data.kind }],
  );
  if (cycle) {
    const name = new Map(titles.map((t) => [t.id, t.title]));
    return NextResponse.json({ error: `That would create a loop: ${cycle.map((c) => name.get(c) ?? c).join(" → ")}` }, { status: 400 });
  }
  await prisma.taskDependency.upsert({
    where: { taskId_dependsOnTaskId: { taskId: task.id, dependsOnTaskId: other.id } },
    create: { taskId: task.id, dependsOnTaskId: other.id, kind: parsed.data.kind, source: "manual", createdByUserId: session.user.id },
    update: { kind: parsed.data.kind },
  });
  // A blocking predecessor that is still open pulls a Ready step back to Not active.
  if (parsed.data.kind === "BLOCKING" && task.status === "PENDING" && task.activatedAt && other.status !== "COMPLETED" && other.status !== "CANCELLED") {
    await prisma.task.update({ where: { id: task.id }, data: { activatedAt: null } });
  }
  await recordTaskEvent({ taskId: task.id, actorUserId: session.user.id, type: "DEPENDENCY_ADDED", toValue: other.id });
  await recordAudit({ actorUserId: session.user.id, entityType: "Task", entityId: task.id, action: "dependency_override", after: { dependsOnTaskId: other.id, kind: parsed.data.kind } });
  return NextResponse.json({ ok: true });
}

/** Remove a dependency (manual or workflow-made). `?dependsOnTaskId=` */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const dependsOnTaskId = request.nextUrl.searchParams.get("dependsOnTaskId");
  if (!dependsOnTaskId) return badRequest("dependsOnTaskId is required");
  const task = await load(id);
  if (!task || (!task.jobId && !task.violationCaseId) || !task.workflowInstanceId) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const subjectScope = await subjectScopeForTask(task);
  if (!subjectScope || !canEditDependencies(session.user, subjectScope)) return forbidden();
  const existing = await prisma.taskDependency.findUnique({ where: { taskId_dependsOnTaskId: { taskId: id, dependsOnTaskId } }, select: { id: true, source: true } });
  if (!existing) return NextResponse.json({ error: "No such dependency" }, { status: 404 });
  await prisma.taskDependency.delete({ where: { id: existing.id } });
  await recordTaskEvent({ taskId: id, actorUserId: session.user.id, type: "DEPENDENCY_REMOVED", toValue: dependsOnTaskId, body: existing.source });
  await recordAudit({ actorUserId: session.user.id, entityType: "Task", entityId: id, action: "dependency_override", before: { dependsOnTaskId, source: existing.source } });
  await sweepActivation(task.workflowInstanceId, session.user.id);
  return NextResponse.json({ ok: true });
}
