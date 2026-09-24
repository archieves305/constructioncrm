import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { summarizeTasks } from "@/lib/tasks/summary";

/**
 * My open work, counted: feeds the sidebar badge, the field bottom nav and
 * the tasks-page pills. Inherently own-only (assignee = me), so no visibility
 * filter is needed. One narrow query and a pure count — tens of rows per
 * person, and the date boundary is decided in code so it matches the UI.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const rows = await prisma.task.findMany({
    where: { assignedUserId: session.user.id, ...ACTIVE_OPEN_WHERE },
    select: { dueAt: true, status: true },
  });

  return NextResponse.json(summarizeTasks(rows), {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
