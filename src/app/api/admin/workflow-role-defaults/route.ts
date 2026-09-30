import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { roleDefaultsSchema } from "@/lib/validators/workflow";
import { canEditRoleDefaults, canViewRoleDefaults } from "@/lib/workflows/access";
import { reassignUnresolved, WORKFLOW_ROLE_LABEL, WORKFLOW_ROLES } from "@/lib/workflows/roles";
import type { WorkflowRole } from "@/generated/prisma/client";

async function list() {
  const rows = await prisma.workflowRoleDefault.findMany({
    include: { user: { select: { id: true, firstName: true, lastName: true, isActive: true } } },
  });
  const byRole = new Map(rows.map((r) => [r.role, r]));
  return WORKFLOW_ROLES.map((role) => ({
    role,
    label: WORKFLOW_ROLE_LABEL[role],
    user: byRole.get(role)?.user ?? null,
    updatedAt: byRole.get(role)?.updatedAt ?? null,
  }));
}

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewRoleDefaults(session.user.role)) return forbidden();
  return NextResponse.json(await list());
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canEditRoleDefaults(session.user.role)) return forbidden();

  const parsed = await validateBody(request, roleDefaultsSchema);
  if (!parsed.ok) return parsed.response;

  const before = await list();
  for (const [role, userId] of Object.entries(parsed.data.defaults) as [WorkflowRole, string | null][]) {
    if (userId) {
      await prisma.workflowRoleDefault.upsert({
        where: { role },
        create: { role, userId, updatedByUserId: session.user.id },
        update: { userId, updatedByUserId: session.user.id },
      });
    } else {
      await prisma.workflowRoleDefault.deleteMany({ where: { role } });
    }
  }
  // A new default is no use to steps that were born with nobody: give every
  // open, unowned step on a running workflow its owner now (one batched
  // notice per workflow for the steps that are already active).
  let assigned = 0;
  if (Object.values(parsed.data.defaults).some(Boolean)) {
    const running = await prisma.jobWorkflowInstance.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
    for (const inst of running) assigned += await reassignUnresolved(inst.id, session.user.id);
  }
  const after = await list();
  await recordAudit({
    actorUserId: session.user.id,
    entityType: "WorkflowRoleDefault",
    entityId: "all",
    action: "update",
    before: before.map((b) => ({ role: b.role, userId: b.user?.id ?? null })),
    after: after.map((a) => ({ role: a.role, userId: a.user?.id ?? null })),
  });
  return NextResponse.json(after, { headers: { "x-steps-assigned": String(assigned) } });
}
