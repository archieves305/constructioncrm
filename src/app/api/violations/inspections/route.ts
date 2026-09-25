import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { buildInspectionWhere, parseScheduleParams } from "@/lib/violations/query";

/** Every agency inspection the viewer may see, for the Inspections page. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const params = parseScheduleParams(request.nextUrl.searchParams);
  const rows = await prisma.codeViolationInspection.findMany({
    where: buildInspectionWhere(params, { user: session.user, now: new Date() }),
    orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }, { requestedAt: "asc" }],
    take: 500,
    include: {
      attendee: { select: { id: true, firstName: true, lastName: true } },
      case: { select: { id: true, caseNumber: true, title: true, jurisdiction: true, status: true, caseManager: { select: { id: true, firstName: true, lastName: true } }, lead: { select: { propertyAddress1: true, city: true } } } },
    },
  });
  return NextResponse.json(rows);
}
