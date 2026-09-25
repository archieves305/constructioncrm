import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { buildHearingWhere, parseScheduleParams } from "@/lib/violations/query";

/** Every hearing the viewer may see, date-first, for the Hearings page. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const params = parseScheduleParams(request.nextUrl.searchParams);
  const rows = await prisma.codeViolationHearing.findMany({
    where: buildHearingWhere(params, { user: session.user, now: new Date() }),
    orderBy: { scheduledAt: params.status === "completed" ? "desc" : "asc" },
    take: 500,
    include: {
      attendee: { select: { id: true, firstName: true, lastName: true } },
      case: { select: { id: true, caseNumber: true, title: true, jurisdiction: true, status: true, caseManager: { select: { id: true, firstName: true, lastName: true } }, lead: { select: { propertyAddress1: true, city: true } } } },
    },
  });
  return NextResponse.json(rows);
}
