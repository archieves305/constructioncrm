import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";

// Cross-job field-issue queue for the office.
const OFFICE_ROLES = new Set(["ADMIN", "MANAGER", "OFFICE_STAFF"]);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!OFFICE_ROLES.has(session.user.role)) return forbidden();

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  const assignedUserId = searchParams.get("assignedUserId");

  const issues = await prisma.fieldIssue.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(type ? { type: type as never } : {}),
      ...(assignedUserId
        ? { assignedUserId: assignedUserId === "me" ? session.user.id : assignedUserId }
        : {}),
    },
    include: {
      job: { select: { id: true, jobNumber: true, title: true } },
      raisedBy: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json(issues);
}
