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

// One-tap crew check-out: stamps timestamp + GPS and sets the end time from
// the client's local clock. Values past 1439 mean past midnight (next day).
const bodySchema = z.object({
  minutes: z.number().int().min(0).max(2879),
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
        checkOutAt: new Date(),
        checkOutLat: v.data.lat ?? null,
        checkOutLng: v.data.lng ?? null,
        endMinutes: v.data.minutes,
      },
    });
    await recomputeWorkerWeeks(
      tx,
      [{ personnelId: entry.personnelId, workDate: date }],
      settings,
    );
  });

  return NextResponse.json({ ok: true, endMinutes: v.data.minutes });
}
