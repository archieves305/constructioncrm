import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { visibilityScopeFor } from "@/lib/workflows/visibility";
import { coerceUsersParam } from "@/lib/calendar/access";
import { toCalendarItem } from "@/lib/calendar/items";
import { buildUnscheduledWhere, readUnscheduledParams, UNSCHEDULED_CAP } from "@/lib/calendar/query";
import { CALENDAR_ITEM_SELECT } from "@/lib/calendar/select";
import type { CalendarUnscheduledResponse } from "@/lib/calendar/types";

/**
 * Active work nobody has given a day yet. Never the not-yet-active workflow
 * steps (639 of them in prod) — those are not anyone's work until their
 * predecessors close. Own-only roles see their own undated tasks.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const now = new Date();
  const params = readUnscheduledParams(request.nextUrl.searchParams);
  const sel = coerceUsersParam(params.users, session.user.role);
  const scope = await visibilityScopeFor(session.user);

  const rows = await prisma.task.findMany({
    where: buildUnscheduledWhere(params, sel, session.user, scope),
    select: CALENDAR_ITEM_SELECT,
    orderBy: [{ priority: "desc" }, { activatedAt: "asc" }, { id: "asc" }],
    take: UNSCHEDULED_CAP + 1,
  });

  const truncated = rows.length > UNSCHEDULED_CAP;
  const body: CalendarUnscheduledResponse = {
    truncated,
    items: (truncated ? rows.slice(0, UNSCHEDULED_CAP) : rows).map((r) => toCalendarItem(r, now)),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
