import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { visibilityScopeFor } from "@/lib/workflows/visibility";
import { coerceUsersParam } from "@/lib/calendar/access";
import { compareDayItems } from "@/lib/calendar/agenda";
import { toCalendarItem } from "@/lib/calendar/items";
import { loadOverlays } from "@/lib/calendar/overlays-load";
import { buildCalendarWhere, CALENDAR_CAP, readCalendarParams } from "@/lib/calendar/query";
import { CALENDAR_ITEM_SELECT } from "@/lib/calendar/select";
import type { CalendarRangeResponse } from "@/lib/calendar/types";
import { APP_TIME_ZONE } from "@/lib/time/zone";


/**
 * Everything on the calendar between two days, for the people asked about.
 *
 * Thin on purpose: parse → coerce the people to what this role may see →
 * one `findMany` → normalise. Own-only roles always get their own calendar
 * whatever `users=` says, and the task visibility filter is applied on top.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const parsed = readCalendarParams(request.nextUrl.searchParams);
  if (!parsed.ok) return badRequest(parsed.error);

  const now = new Date();
  const sel = coerceUsersParam(parsed.params.users, session.user.role);
  const scope = await visibilityScopeFor(session.user);
  const where = buildCalendarWhere(parsed.params, sel, session.user, scope);

  const [rows, overlays] = await Promise.all([
    prisma.task.findMany({
      where,
      select: CALENDAR_ITEM_SELECT,
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { id: "asc" }],
      take: CALENDAR_CAP + 1,
    }),
    loadOverlays(parsed.params, sel, session.user, scope, now),
  ]);

  const truncated = rows.length > CALENDAR_CAP;
  const tasks = (truncated ? rows.slice(0, CALENDAR_CAP) : rows).map((r) => toCalendarItem(r, now));
  const body: CalendarRangeResponse = {
    range: { from: parsed.params.from, to: parsed.params.to, timeZone: APP_TIME_ZONE },
    truncated,
    items: [...tasks, ...overlays.sort(compareDayItems)],
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
