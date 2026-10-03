import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { prisma } from "@/lib/db/prisma";
import { raisePermitAlerts, settlePermitAlerts } from "@/lib/permits/alert-run";
import { recordAudit } from "@/lib/audit/record";
import { dayKey } from "@/lib/time/zone";

/**
 * Daily sweep. Moves a permit in force whose expiration day has passed to
 * EXPIRED (audited), so the board, the job's health and the gates that need
 * an issued permit all say so — then raises the permit follow-ups as ordinary
 * tasks (`lib/permits/alert-run.ts`): still waiting after 7 days, still
 * waiting after 14, expiring within 30. Each is raised once, so running this
 * every day never repeats one.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const now = Date.now();
  let expired = 0;

  // Expired: the whole expiration day has passed in the office's zone.
  const lapsed = await prisma.jobPermit.findMany({
    where: { status: { in: ["ISSUED", "IN_PROGRESS"] }, expirationDate: { not: null, lt: new Date(`${dayKey(new Date(now))}T00:00:00.000Z`) } },
    select: { id: true, status: true },
  });
  for (const p of lapsed) {
    await prisma.jobPermit.update({ where: { id: p.id }, data: { status: "EXPIRED" } });
    await recordAudit({ entityType: "JobPermit", entityId: p.id, action: "status_change", before: { status: p.status }, after: { status: "EXPIRED", by: "permit-aging cron" } });
    await settlePermitAlerts(p.id, null);
    expired += 1;
  }

  const alerts = await raisePermitAlerts();
  return NextResponse.json({ expired, ...alerts });
}
