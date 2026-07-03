import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { recomputeWorkerWeeks } from "@/lib/labor/recompute";
import { getLaborSettings } from "@/lib/labor/settings";

type Context = { params: Promise<{ id: string; date: string; entryId: string }> };

// One-tap crew check-in: stamps the timestamp + GPS and sets the entry's
// start time to the client's local clock (sent as minutes-from-midnight —
// the server may sit in another timezone).
const bodySchema = z.object({
  minutes: z.number().int().min(0).max(1439),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
});

export async function POST(request: NextRequest, context: Context) {
  const { id: jobId, date, entryId } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const v = await validateBody(request, bodySchema);
  if (!v.ok) return v.response;

  const entry = await prisma.dailyLaborEntry.findUnique({
    where: { id: entryId },
    include: { dailyLog: { select: { jobId: true, status: true } } },
  });
  if (!entry || entry.dailyLog.jobId !== jobId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (entry.dailyLog.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Log is no longer editable" },
      { status: 409 },
    );
  }

  const settings = await getLaborSettings();
  await prisma.$transaction(async (tx) => {
    await tx.dailyLaborEntry.update({
      where: { id: entryId },
      data: {
        checkInAt: new Date(),
        checkInLat: v.data.lat ?? null,
        checkInLng: v.data.lng ?? null,
        startMinutes: v.data.minutes,
        isAbsent: false,
      },
    });
    await recomputeWorkerWeeks(
      tx,
      [{ personnelId: entry.personnelId, workDate: date }],
      settings,
    );
  });

  return NextResponse.json({ ok: true, startMinutes: v.data.minutes });
}
