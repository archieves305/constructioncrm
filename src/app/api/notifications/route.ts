import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const limit = Math.min(50, Number(request.nextUrl.searchParams.get("limit") || 20));
  const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";

  const where = {
    recipientUserId: session.user.id,
    ...(unreadOnly ? { readAt: null } : {}),
  };

  const [items, unreadCount] = await Promise.all([
    prisma.notificationEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        lead: { select: { id: true, fullName: true } },
      },
    }),
    prisma.notificationEvent.count({
      where: { recipientUserId: session.user.id, readAt: null },
    }),
  ]);

  return NextResponse.json({ items, unreadCount });
}
