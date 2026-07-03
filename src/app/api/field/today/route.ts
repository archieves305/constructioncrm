import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";

// Jobs the signed-in user works with in field mode. Office roles see all
// open jobs; CREW_LEAD sees jobs where they're the PM (extended with
// JobFieldAssignment scoping when daily logs land in Phase 2).
const FIELD_ROLES = new Set(["ADMIN", "MANAGER", "OFFICE_STAFF", "CREW_LEAD", "READ_ONLY"]);

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!FIELD_ROLES.has(session.user.role)) return forbidden();

  const where: Record<string, unknown> = {
    currentStage: { isClosed: false },
  };
  if (session.user.role === "CREW_LEAD") {
    where.projectManagerId = session.user.id;
  }

  const jobs = await prisma.job.findMany({
    where,
    select: {
      id: true,
      jobNumber: true,
      title: true,
      serviceType: true,
      scheduledDate: true,
      currentStage: { select: { name: true } },
      lead: {
        select: {
          propertyAddress1: true,
          city: true,
        },
      },
    },
    orderBy: [{ scheduledDate: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return NextResponse.json({ jobs });
}
