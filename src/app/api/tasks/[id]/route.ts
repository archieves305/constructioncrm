import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { updateTaskSchema } from "@/lib/validators/task";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) return badRequest(JSON.stringify(parsed.error.issues));

  const input = parsed.data;
  const completedAt =
    input.status === "COMPLETED" ? new Date() : undefined;

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...input,
      dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      completedAt,
    },
    include: {
      lead: { select: { id: true, fullName: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (input.status === "COMPLETED" && task.leadId) {
    await prisma.activityLog.create({
      data: {
        leadId: task.leadId,
        activityType: "TASK_COMPLETED",
        title: `Task completed: ${task.title}`,
        createdByUserId: session.user.id,
      },
    });
  }

  return NextResponse.json(task);
}
