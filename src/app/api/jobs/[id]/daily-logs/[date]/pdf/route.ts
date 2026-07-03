import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { buildDailyLogPdfData } from "@/lib/labor/pdf-data";
import { renderDailyLogPdf } from "@/lib/pdf/daily-log";

type Context = { params: Promise<{ id: string; date: string }> };

const MAX_PDF_PHOTOS = 30;

export async function GET(_request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      jobNumber: true,
      title: true,
      lead: { select: { propertyAddress1: true, city: true, state: true } },
    },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = await buildDailyLogPdfData(jobId, date, job, ctx.session.user.role, {
    maxPhotos: MAX_PDF_PHOTOS,
  });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pdf = await renderDailyLogPdf(data);
  const ab = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(ab).set(pdf);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="daily-report-${job.jobNumber}-${date}.pdf"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
