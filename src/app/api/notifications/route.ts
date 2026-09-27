import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { hrefForRole } from "@/lib/notifications/links";
import { filterWhere, parseNotificationFilter } from "@/lib/notifications/filters";

/**
 * The bell and the notification center read the notifications-v2 table:
 * one row per event per person, whatever channel it went out on.
 *
 * ?filter=all|action|mentions|tasks|jobs  ?unread=true  ?since=<ISO>
 * ?limit=  ?cursor=<id>   (newest first, cursor = last id seen)
 */
const SELECT = {
  id: true,
  kind: true,
  category: true,
  title: true,
  body: true,
  href: true,
  priority: true,
  actionRequired: true,
  deliveryClass: true,
  occurrences: true,
  readAt: true,
  emailedAt: true,
  createdAt: true,
  lastOccurredAt: true,
  taskId: true,
  jobId: true,
  leadId: true,
  violationCaseId: true,
} as const;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const q = request.nextUrl.searchParams;
  const limit = Math.min(50, Math.max(1, Number(q.get("limit") || 20)));
  const unreadOnly = q.get("unread") === "true";
  const filter = parseNotificationFilter(q.get("filter"));
  const cursor = q.get("cursor");
  const sinceRaw = q.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : null;

  const where: Prisma.NotificationWhereInput = {
    recipientUserId: session.user.id,
    deliveryClass: { not: "NONE" },
    ...filterWhere(filter),
    ...(unreadOnly ? { readAt: null } : {}),
    ...(since ? { lastOccurredAt: { gte: since } } : {}),
  };

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ lastOccurredAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: SELECT,
    }),
    prisma.notification.count({ where: { recipientUserId: session.user.id, readAt: null } }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map((n) => ({ ...n, href: hrefForRole(n.href, session.user.role) }));

  return NextResponse.json(
    { items, unreadCount, nextCursor: hasMore ? page[page.length - 1]!.id : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
