import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { patchWorkflowSchema } from "@/lib/validators/workflow";
import { readCaseWorkflow } from "@/lib/workflows/read";
import { visibilityScopeFor } from "@/lib/workflows/visibility";
import { canApplyWorkflow, canCoordinateWorkflow, canSetPermitStatus } from "@/lib/workflows/access";
import { determinePermit, reconcileScope, ReconcileError } from "@/lib/workflows/reconcile";
import { reassignUnresolved } from "@/lib/workflows/roles";
import { toJobScope } from "@/lib/violations/access";
import { requireCase } from "@/lib/violations/route-helpers";
import type { WorkflowRole } from "@/generated/prisma/client";

/** The case's Workflow tab — the same read the job tab uses, on the case subject. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const gate = await requireCase(id, session.user);
  if ("response" in gate) return gate.response;
  const data = await readCaseWorkflow(id, session.user, await visibilityScopeFor(session.user), toJobScope(gate.scope));
  if (!data) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  return NextResponse.json(data);
}

/** Team slots, the permit decision, scope toggles — the same three edits and permissions as a job. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const user = session.user;
  const parsed = await validateBody(request, patchWorkflowSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const gate = await requireCase(id, user);
  if ("response" in gate) return gate.response;
  const subjectScope = toJobScope(gate.scope);
  const instance = await prisma.jobWorkflowInstance.findUnique({ where: { violationCaseId: id }, select: { id: true } });
  if (!instance) return NextResponse.json({ error: "This case has no workflow yet" }, { status: 404 });

  if (body.team !== undefined && !canCoordinateWorkflow(user, subjectScope)) return forbidden();
  if (body.permit !== undefined && !canSetPermitStatus(user, subjectScope)) return forbidden();
  if (body.scopeToggles !== undefined && !canApplyWorkflow(user.role)) return forbidden();

  const result: Record<string, unknown> = {};
  try {
    if (body.team !== undefined) {
      const before = await prisma.jobWorkflowTeamMember.findMany({ where: { instanceId: instance.id }, select: { role: true, userId: true } });
      for (const [role, userId] of Object.entries(body.team) as [WorkflowRole, string | null][]) {
        if (userId) {
          await prisma.jobWorkflowTeamMember.upsert({ where: { instanceId_role: { instanceId: instance.id, role } }, create: { instanceId: instance.id, role, userId }, update: { userId } });
        } else {
          await prisma.jobWorkflowTeamMember.deleteMany({ where: { instanceId: instance.id, role } });
        }
      }
      const reassigned = await reassignUnresolved(instance.id, user.id);
      await recordAudit({ actorUserId: user.id, entityType: "JobWorkflowInstance", entityId: instance.id, action: "workflow_team_changed", before, after: body.team });
      result.team = { reassigned };
    }
    if (body.permit !== undefined) {
      result.permit = await determinePermit({ instanceId: instance.id, status: body.permit.status, notes: body.permit.notes ?? null, documentFileId: body.permit.documentFileId ?? null, jurisdiction: body.permit.jurisdiction, actor: user });
    }
    if (body.scopeToggles !== undefined) {
      result.scope = await reconcileScope({ instanceId: instance.id, scopeToggles: body.scopeToggles, actor: user });
    }
  } catch (err) {
    if (err instanceof ReconcileError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const data = await readCaseWorkflow(id, user, await visibilityScopeFor(user), subjectScope);
  return NextResponse.json({ ...data, result });
}
