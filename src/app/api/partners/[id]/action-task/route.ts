import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { recordAudit } from "@/lib/audit/record";
import { prisma } from "@/lib/db/prisma";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { createTask } from "@/lib/tasks/create";
import { addWorkingDays } from "@/lib/time/working-days";
import { pinAllDay, todayKey } from "@/lib/time/zone";
import { validateBody } from "@/lib/validation/body";

const schema = z.object({ title: z.string().trim().min(3).max(200) });

/** Turn the health score's recommended action into a task on the account, for its owner, due in three working days. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, ownerUserId: true } });
  if (!org) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const dueAt = pinAllDay(addWorkingDays(todayKey(), 3));
  const task = await createTask(
    { title: `${v.data.title} — ${org.name}`, dueAt, allDay: true, assignedUserId: org.ownerUserId ?? session.user.id, createdByUserId: session.user.id, organizationId: org.id, source: "manual" },
    { actorUserId: session.user.id, logLeadActivity: false },
  );
  await prisma.organization.update({ where: { id: org.id }, data: { nextFollowUpAt: dueAt } });
  await recordAudit({ actorUserId: session.user.id, entityType: "Organization", entityId: org.id, action: "health_action_task", after: { taskId: task.id, title: task.title } });
  return NextResponse.json({ id: task.id, title: task.title, dueAt: task.dueAt }, { status: 201 });
}
