import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canViewNurture } from "@/lib/nurture/access";

/** GET — the most recent sends (and skips / failures), newest first. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewNurture(session.user.role)) return forbidden();
  const take = Math.min(500, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 200));
  const rows = await prisma.leadNurtureSend.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { lead: { select: { id: true, fullName: true } }, content: { select: { id: true, subject: true, kind: true } } },
  });
  return NextResponse.json(rows);
}
