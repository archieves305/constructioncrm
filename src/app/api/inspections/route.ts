import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { jobAccessWhere } from "@/lib/access/records";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";

const DAY = 86_400_000;

/**
 * Permit inspections across jobs: everything still booked (dated or not),
 * plus the results of the last `days` days (default 30). A sales rep or crew
 * lead sees the ones on their own jobs.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get("days")) || 30, 1), 365);
  const since = new Date(Date.now() - days * DAY);
  const inspections = await prisma.jobPermitInspection.findMany({
    where: {
      permit: { job: jobAccessWhere(session.user) },
      OR: [{ result: "SCHEDULED" }, { completedAt: { gte: since } }],
    },
    include: {
      task: { select: { id: true, title: true, status: true } },
      permit: { select: { id: true, permitType: true, permitNumber: true, municipality: true, job: { select: JOB_LABEL_SELECT } } },
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  return NextResponse.json(inspections);
}
