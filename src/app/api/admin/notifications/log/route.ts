import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canViewNotificationSettings } from "@/lib/notifications/access";

/** The last digests (one row per person per window) and the last immediate sends. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewNotificationSettings(session.user.role)) return forbidden();
  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 60));
  const [digests, immediates] = await Promise.all([
    prisma.notificationDigest.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, windowKey: true, scheduledFor: true, status: true, attempts: true, lastError: true, sentAt: true, subject: true,
        itemCount: true, collapsedCount: true, hiddenCount: true, suppressedCount: true, sectionCounts: true, createdAt: true,
        recipient: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.notification.findMany({
      where: { deliveryClass: "IMMEDIATE" },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, kind: true, title: true, state: true, attempts: true, lastError: true, emailedAt: true, createdAt: true, classifyReason: true, recipient: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  return NextResponse.json({ digests, immediates });
}
