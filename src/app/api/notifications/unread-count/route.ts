import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

/** The bell's badge: one indexed count, cheap enough to poll. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const unreadCount = await prisma.notification.count({ where: { recipientUserId: session.user.id, readAt: null } });
  return NextResponse.json({ unreadCount }, { headers: { "Cache-Control": "no-store" } });
}
