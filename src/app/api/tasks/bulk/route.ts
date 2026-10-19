import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { recordAudit } from "@/lib/audit/record";
import { updateTask, TaskUpdateError } from "@/lib/tasks/update";
import { validateBody } from "@/lib/validation/body";

/**
 * POST /api/tasks/bulk — the clean-up of a backlog (audit roadmap Stage D):
 * move many tasks to one day, give them to one person, or close them with a
 * reason. ADMIN / MANAGER only. Every task goes through `updateTask` (its
 * timeline, notices and workflow rules: a blocking step is skipped only by
 * these roles, with the reason); one audit row records the run. A task the
 * rules refuse is reported, the rest go ahead.
 */
const MANAGERS = ["ADMIN", "MANAGER"];

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reschedule"), ids: z.array(z.string().min(1)).min(1).max(200), dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a day as yyyy-MM-dd") }),
  z.object({ action: z.literal("assign"), ids: z.array(z.string().min(1)).min(1).max(200), assignedUserId: z.string().min(1) }),
  z.object({ action: z.literal("close"), ids: z.array(z.string().min(1)).min(1).max(200), reason: z.string().trim().min(3, "say why they are being closed").max(500) }),
]);

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!MANAGERS.includes(session.user.role)) return forbidden();
  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const body = v.data;

  const input =
    body.action === "reschedule"
      ? { dueAt: body.dueAt }
      : body.action === "assign"
        ? { assignedUserId: body.assignedUserId }
        : { status: "CANCELLED" as const, skipReason: body.reason };

  const done: string[] = [];
  const refused: { id: string; reason: string }[] = [];
  for (const id of [...new Set(body.ids)]) {
    try {
      await updateTask({ id, input, actorUserId: session.user.id, actorRole: session.user.role });
      done.push(id);
    } catch (err) {
      if (err instanceof TaskUpdateError) refused.push({ id, reason: err.message });
      else throw err;
    }
  }

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "task",
    entityId: "bulk",
    action: `task_bulk_${body.action}`,
    after: { ...("dueAt" in body ? { dueAt: body.dueAt } : {}), ...("assignedUserId" in body ? { assignedUserId: body.assignedUserId } : {}), ...("reason" in body ? { reason: body.reason } : {}), done, refused },
  });
  return NextResponse.json({ done: done.length, refused });
}
