import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canViewNurture } from "@/lib/nurture/access";

/** GET — enrolled leads with their next dates; ?status=ACTIVE|PAUSED|STOPPED, ?q=, ?page=, ?pageSize= */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewNurture(session.user.role)) return forbidden();
  const sp = request.nextUrl.searchParams;
  const status = sp.get("status");
  const q = sp.get("q")?.trim();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(sp.get("pageSize")) || 50));
  const where: Prisma.LeadNurtureStateWhereInput = {
    ...(status === "ACTIVE" || status === "PAUSED" || status === "STOPPED" ? { status } : {}),
    ...(q ? { lead: { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.leadNurtureState.findMany({
      where,
      orderBy: [{ status: "asc" }, { nextFollowUpAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        lead: { select: { id: true, fullName: true, email: true, currentStage: { select: { name: true } }, assignedUser: { select: { firstName: true, lastName: true } } } },
        sends: { orderBy: { createdAt: "desc" }, take: 1, select: { kind: true, status: true, subject: true, sentAt: true, createdAt: true } },
      },
    }),
    prisma.leadNurtureState.count({ where }),
  ]);
  // Shared addresses (family, landlord) are worth a badge in the queue.
  const emails = rows.map((r) => r.lead.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e));
  const dup = new Set(emails.filter((e, i) => emails.indexOf(e) !== i));
  return NextResponse.json({
    data: rows.map((r) => ({ ...r, sharedEmail: r.lead.email ? dup.has(r.lead.email.trim().toLowerCase()) : false })),
    total,
    page,
    pageSize,
  });
}
