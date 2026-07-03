import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { badRequest } from "@/lib/auth/helpers";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { addDays, fromDbDate, isIsoDate, toDbDate } from "@/lib/labor/dates";
import { buildDailyLogPdfData } from "@/lib/labor/pdf-data";
import { renderDailyLogPackagePdf } from "@/lib/pdf/daily-log";
import { format } from "date-fns";

type Context = { params: Promise<{ id: string }> };

// "Hotel package": one PDF bundling every daily report in a date range.
// Guardrails keep render memory bounded: ≤14 days, ≤12 photos per day.
const MAX_RANGE_DAYS = 14;
const MAX_PHOTOS_PER_DAY = 12;

export async function GET(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  const { searchParams } = request.nextUrl;
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end || !isIsoDate(start) || !isIsoDate(end)) {
    return badRequest("start and end are required (YYYY-MM-DD)");
  }
  if (start > end) return badRequest("start must be on or before end");
  if (addDays(start, MAX_RANGE_DAYS - 1) < end) {
    return badRequest(`Range too large — at most ${MAX_RANGE_DAYS} days per package`);
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      jobNumber: true,
      title: true,
      lead: { select: { propertyAddress1: true, city: true, state: true } },
    },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const logs = await prisma.dailyLog.findMany({
    where: { jobId, logDate: { gte: toDbDate(start), lte: toDbDate(end) } },
    select: { logDate: true },
    orderBy: { logDate: "asc" },
  });
  if (logs.length === 0) {
    return NextResponse.json(
      { error: "No daily logs in this date range" },
      { status: 404 },
    );
  }

  const days = [];
  for (const log of logs) {
    const data = await buildDailyLogPdfData(
      jobId,
      fromDbDate(log.logDate),
      job,
      ctx.session.user.role,
      { maxPhotos: MAX_PHOTOS_PER_DAY },
    );
    if (data) days.push(data);
  }

  const totalHours = days.reduce(
    (s, d) => s + d.totals.regularHours + d.totals.otHours,
    0,
  );
  const totalOt = days.reduce((s, d) => s + d.totals.otHours, 0);
  const totalCost = days.every((d) => d.totals.cost != null)
    ? days.reduce((s, d) => s + (d.totals.cost ?? 0), 0)
    : undefined;

  const pdf = await renderDailyLogPackagePdf(
    {
      jobNumber: job.jobNumber,
      jobTitle: job.title,
      jobAddress:
        [job.lead.propertyAddress1, job.lead.city, job.lead.state]
          .filter(Boolean)
          .join(", ") || null,
      rangeLabel: `${format(new Date(`${start}T12:00:00`), "MMM d")} – ${format(new Date(`${end}T12:00:00`), "MMM d, yyyy")}`,
      dayCount: days.length,
      totalHours: Math.round(totalHours * 100) / 100,
      totalOtHours: Math.round(totalOt * 100) / 100,
      ...(totalCost != null ? { totalCost: Math.round(totalCost * 100) / 100 } : {}),
      generatedAt: format(new Date(), "MMM d, yyyy h:mm a"),
    },
    days,
  );

  const ab = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(ab).set(pdf);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="daily-reports-${job.jobNumber}-${start}-to-${end}.pdf"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
