import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { prisma } from "@/lib/db/prisma";
import { emitInspectionEvent } from "@/lib/follow-ups/permit-events";

const HOUR = 60 * 60 * 1000;

/**
 * Emits INSPECTION_REMINDER_24H for SCHEDULED inspections whose scheduledFor
 * lands in the next 23–25 hours. Designed to run hourly; the 2-hour window
 * absorbs cron jitter without missing inspections.
 *
 * Each rule is deduped per inspection for 5 days so repeated runs over the
 * window only fire once.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const now = Date.now();
  const windowStart = new Date(now + 23 * HOUR);
  const windowEnd = new Date(now + 25 * HOUR);

  const upcoming = await prisma.jobPermitInspection.findMany({
    where: {
      result: "SCHEDULED",
      scheduledFor: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true },
  });

  let fired = 0;
  for (const insp of upcoming) {
    fired += await emitInspectionEvent("INSPECTION_REMINDER_24H", insp.id, {
      dedupeWindowDays: 5,
    });
  }

  return NextResponse.json({ scanned: upcoming.length, fired });
}
