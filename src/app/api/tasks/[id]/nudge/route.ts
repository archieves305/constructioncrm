import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { nudgeSchema } from "@/lib/validators/task";
import { canNudgeTask } from "@/lib/tasks/access";
import { recordTaskEvent } from "@/lib/tasks/events";
import { notifyTaskNudged } from "@/lib/tasks/notify";
import { resolveRecipients } from "@/lib/tasks/recipients";
import { isOpenStatus } from "@/lib/tasks/status";
import { nudgeCooldownMessage, nudgeCooldownRemainingMs } from "@/lib/tasks/nudge-policy";

/**
 * POST /api/tasks/[id]/nudge — "checking in on this", from whoever is waiting.
 *
 * One per task per 24 hours. The ledger is the NUDGED timeline row, written
 * synchronously so a double-click cannot slip two through the same check.
 * The recipient check is also done up front so the response can say whether
 * mail will actually go out — "nudged, but Frank has nudges muted" is worth a
 * toast, not a silent no-op.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const parsed = await validateBody(request, nudgeSchema);
  if (!parsed.ok) return parsed.response;
  const message = parsed.data.message?.trim() || null;

  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      assignedUserId: true,
      createdByUserId: true,
      assignedTo: { select: { firstName: true } },
      events: {
        where: { type: "NUDGED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { type: true, createdAt: true },
      },
    },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!canNudgeTask(session.user, task)) return forbidden();
  if (!task.assignedUserId) return badRequest("Nobody is assigned to this task — assign it first");
  if (task.assignedUserId === session.user.id) {
    return badRequest("You are the assignee — add a note instead");
  }
  if (!isOpenStatus(task.status)) {
    return NextResponse.json({ error: "This task is closed" }, { status: 409 });
  }

  const remaining = nudgeCooldownRemainingMs(task.events);
  if (remaining > 0) {
    return NextResponse.json(
      {
        error: nudgeCooldownMessage(task.assignedTo?.firstName ?? "They", remaining),
        retryAt: new Date(Date.now() + remaining).toISOString(),
      },
      { status: 429 },
    );
  }

  await recordTaskEvent({
    taskId: id,
    actorUserId: session.user.id,
    type: "NUDGED",
    toValue: task.assignedUserId,
    body: message,
  });

  const { recipients, skipped } = await resolveRecipients({
    candidates: [{ userId: task.assignedUserId, reason: "assignee" }],
    suppressUserId: session.user.id,
    channel: "nudge",
  });

  const actorUserId = session.user.id;
  after(async () => {
    await notifyTaskNudged({ taskId: id, actorUserId, message });
  });

  return NextResponse.json({
    ok: true,
    willEmail: recipients.length > 0,
    skipped: skipped.find((s) => s.userId === task.assignedUserId)?.reason ?? null,
  });
}
