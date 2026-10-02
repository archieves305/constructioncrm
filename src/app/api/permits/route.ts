import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { PermitStatus } from "@/generated/prisma/client";
import { jobAccessWhere } from "@/lib/access/records";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || undefined;
  const municipality = searchParams.get("municipality") || undefined;
  const assignedUserId = searchParams.get("assignedUserId") || undefined;
  const aging = searchParams.get("aging") === "true";

  // An unknown status used to reach Prisma and come back as a 500.
  if (status && !(status in PermitStatus)) return badRequest(`status must be one of ${Object.keys(PermitStatus).join(", ")}`);

  // A sales rep or crew lead sees the permits on their own jobs.
  const where: Record<string, unknown> = { job: jobAccessWhere(session.user) };
  if (status) where.status = status;
  if (municipality) where.municipality = { contains: municipality, mode: "insensitive" };
  if (assignedUserId === "unassigned") {
    where.assignedUserId = null;
  } else if (assignedUserId) {
    where.assignedUserId = assignedUserId;
  }

  if (aging) {
    // Permits submitted more than 14 days ago without approval
    where.status = { in: ["APPLIED", "IN_PROGRESS"] };
    where.submittedDate = { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) };
  }

  const permits = await prisma.jobPermit.findMany({
    where,
    include: {
      job: {
        select: {
          id: true, jobNumber: true, title: true,
          lead: { select: { fullName: true, propertyAddress1: true, city: true, county: true } },
        },
      },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Compute aging days
  const enriched = permits.map((p) => ({
    ...p,
    agingDays: p.submittedDate
      ? Math.floor((Date.now() - new Date(p.submittedDate).getTime()) / (24 * 60 * 60 * 1000))
      : null,
  }));

  return NextResponse.json(enriched);
}
