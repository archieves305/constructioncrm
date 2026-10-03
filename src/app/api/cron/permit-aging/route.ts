import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { prisma } from "@/lib/db/prisma";
import { emitPermitEvent } from "@/lib/follow-ups/permit-events";
import { recordAudit } from "@/lib/audit/record";
import { dayKey } from "@/lib/time/zone";

const MS_PER_DAY = 86400000;

/**
 * Daily sweep that fires:
 *   - PERMIT_AGING_7D  — APPLIED/IN_PROGRESS permits submitted ≥ 7 days ago
 *   - PERMIT_AGING_14D — APPLIED/IN_PROGRESS permits submitted ≥ 14 days ago
 *   - PERMIT_EXPIRING_30D — ISSUED permits whose expirationDate is within 30 days
 *
 * and moves a permit in force whose expiration day has passed to EXPIRED
 * (audited; PERMIT_STATUS_EXPIRED fires once, on the change), so the board,
 * the job's health and the gates that need an issued permit all say so.
 *
 * Each event is deduped against any non-CANCELLED FollowUpExecution it
 * created in the last 30 days, so re-running this every day doesn't refire
 * the same alert.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * MS_PER_DAY);
  const fourteenDaysAgo = new Date(now - 14 * MS_PER_DAY);
  const thirtyDaysOut = new Date(now + 30 * MS_PER_DAY);

  const aging = await prisma.jobPermit.findMany({
    where: {
      status: { in: ["APPLIED", "IN_PROGRESS"] },
      submittedDate: { lte: sevenDaysAgo },
    },
    select: { id: true, submittedDate: true },
  });

  const expiring = await prisma.jobPermit.findMany({
    where: {
      status: "ISSUED",
      expirationDate: { not: null, lte: thirtyDaysOut, gt: new Date(now) },
    },
    select: { id: true },
  });

  const results = { aging7d: 0, aging14d: 0, expiring30d: 0, expired: 0 };

  // Expired: the whole expiration day has passed in the office's zone.
  const lapsed = await prisma.jobPermit.findMany({
    where: { status: { in: ["ISSUED", "IN_PROGRESS"] }, expirationDate: { not: null, lt: new Date(`${dayKey(new Date(now))}T00:00:00.000Z`) } },
    select: { id: true, status: true },
  });
  for (const p of lapsed) {
    await prisma.jobPermit.update({ where: { id: p.id }, data: { status: "EXPIRED" } });
    await recordAudit({ entityType: "JobPermit", entityId: p.id, action: "status_change", before: { status: p.status }, after: { status: "EXPIRED", by: "permit-aging cron" } });
    await emitPermitEvent("PERMIT_STATUS_EXPIRED", p.id);
    results.expired += 1;
  }

  for (const p of aging) {
    if (!p.submittedDate) continue;
    if (p.submittedDate <= fourteenDaysAgo) {
      results.aging14d += await emitPermitEvent("PERMIT_AGING_14D", p.id, {
        dedupeWindowDays: 30,
      });
    } else {
      results.aging7d += await emitPermitEvent("PERMIT_AGING_7D", p.id, {
        dedupeWindowDays: 30,
      });
    }
  }

  for (const p of expiring) {
    results.expiring30d += await emitPermitEvent("PERMIT_EXPIRING_30D", p.id, {
      dedupeWindowDays: 30,
    });
  }

  return NextResponse.json(results);
}
