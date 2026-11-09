import { NextRequest, NextResponse } from "next/server";
import { ActivityType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardLead } from "@/lib/access/records";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const denied = await guardLead(session.user, id, "read");
  if (denied) return denied;
  const { searchParams } = request.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "50");
  // ?type=NOTE (or a comma list): only those kinds. The phone reads notes this
  // way, so other lines (payments, stage moves) never reach it.
  const types = (searchParams.get("type") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x): x is ActivityType => (Object.values(ActivityType) as string[]).includes(x));

  const activities = await prisma.activityLog.findMany({
    where: {
      leadId: id,
      ...(types.length ? { activityType: { in: types } } : {}),
      // ?notesOnly=1: notes people wrote, not the CRM's own NOTE lines (an
      // expense's "Expense added … $" line carries money the phone never shows).
      ...(searchParams.get("notesOnly") === "1" ? { activityType: "NOTE" as const, title: "Note added", createdByUserId: { not: null } } : {}),
    },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return NextResponse.json(activities);
}
