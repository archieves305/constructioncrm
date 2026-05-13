import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { emitPermitEvent } from "@/lib/follow-ups/permit-events";

const MS_PER_DAY = 86400000;

/**
 * Daily sweep that fires:
 *   - PERMIT_AGING_7D  — APPLIED/IN_PROGRESS permits submitted ≥ 7 days ago
 *   - PERMIT_AGING_14D — APPLIED/IN_PROGRESS permits submitted ≥ 14 days ago
 *   - PERMIT_EXPIRING_30D — ISSUED permits whose expirationDate is within 30 days
 *
 * Each event is deduped against any non-CANCELLED FollowUpExecution it
 * created in the last 30 days, so re-running this every day doesn't refire
 * the same alert.
 */
export async function POST(request: NextRequest) {
  const secret = env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");

  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 503 },
    );
  }
  if (provided !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const results = { aging7d: 0, aging14d: 0, expiring30d: 0 };

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
