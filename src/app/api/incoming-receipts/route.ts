import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const status = request.nextUrl.searchParams.get("status") || undefined;

  const receipts = await prisma.incomingReceipt.findMany({
    where: status
      ? { status: status as "UNMATCHED" | "MATCHED" | "DISMISSED" }
      : undefined,
    orderBy: [{ status: "asc" }, { purchaseDate: "desc" }],
    take: 500,
    include: {
      matchedJob: {
        select: {
          id: true,
          jobNumber: true,
          lead: { select: { fullName: true, propertyAddress1: true } },
        },
      },
      uploadedBy: { select: { firstName: true, lastName: true } },
    },
  });

  const counts = await prisma.incomingReceipt.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const byStatus: Record<string, number> = { UNMATCHED: 0, MATCHED: 0, DISMISSED: 0 };
  for (const c of counts) byStatus[c.status] = c._count._all;

  return NextResponse.json({ receipts, counts: byStatus });
}
