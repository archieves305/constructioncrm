import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { roleDefaultsSchema } from "@/lib/validators/workflow";
import { canEditRoleDefaults, canViewRoleDefaults } from "@/lib/workflows/access";
import { WORKFLOW_ROLE_LABEL, WORKFLOW_ROLES } from "@/lib/workflows/roles";
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
  const after = await list();
  await recordAudit({
    actorUserId: session.user.id,
    entityType: "WorkflowRoleDefault",
    entityId: "all",
    action: "update",
    before: before.map((b) => ({ role: b.role, userId: b.user?.id ?? null })),
    after: after.map((a) => ({ role: a.role, userId: a.user?.id ?? null })),
  });
  return NextResponse.json(after);
}
