import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { isEmailConfigured } from "@/lib/email/send";
import { hasMinRole } from "@/lib/auth/helpers";

/**
 * Delivery-failure history, read from the durable audit rows.
 *
 * This is the channel that still answers when email is the broken thing —
 * an alert email cannot tell you that email is down. Point a human here when
 * someone says "I never got it".
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!hasMinRole(session.user.role, "MANAGER")) return forbidden();

  const days = Math.min(Number(request.nextUrl.searchParams.get("days") ?? 14) || 14, 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const events = await prisma.auditEvent.findMany({
    where: {
      entityType: "EmailDelivery",
      action: "delivery_failure",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, entityId: true, afterJson: true, createdAt: true },
  });

  // Roll up by recipient — "who is not receiving mail" is the question people
  // actually arrive with, and it cuts across which job happened to notice.
  const byRecipient = new Map<string, { failures: number; sources: Set<string>; last: Date }>();
  for (const e of events) {
    const payload = e.afterJson as { recipients?: unknown } | null;
    const recipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
    for (const r of recipients) {
      if (typeof r !== "string") continue;
      const entry = byRecipient.get(r) ?? {
        failures: 0,
        sources: new Set<string>(),
        last: e.createdAt,
      };
      entry.failures++;
      entry.sources.add(e.entityId);
      if (e.createdAt > entry.last) entry.last = e.createdAt;
      byRecipient.set(r, entry);
    }
  }

  const affectedRecipients = [...byRecipient.entries()]
    .map(([recipient, v]) => ({
      recipient,
      failures: v.failures,
      sources: [...v.sources],
      lastFailedAt: v.last,
    }))
    .sort((a, b) => b.failures - a.failures);

  return NextResponse.json(
    {
      windowDays: days,
      emailConfigured: isEmailConfigured(),
      healthy: events.length === 0,
      totalFailureEvents: events.length,
      affectedRecipients,
      recent: events.slice(0, 25).map((e) => ({
        id: e.id,
        source: e.entityId,
        at: e.createdAt,
        detail: e.afterJson,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
