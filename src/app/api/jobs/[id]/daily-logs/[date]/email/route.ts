import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { buildDailyLogPdfData } from "@/lib/labor/pdf-data";
import { renderDailyLogPdf } from "@/lib/pdf/daily-log";
import { sendEmail } from "@/lib/email/send";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";
import { format } from "date-fns";

type Context = { params: Promise<{ id: string; date: string }> };

// Email a daily report PDF to a recipient of the sender's choosing (owner,
// GC, inspector…). The attached PDF is ALWAYS the cost-free variant — once
// it leaves the CRM we can't control forwarding, so internal rates/costs
// never ride along regardless of who sends. Every send is audited with the
// recipient.
const bodySchema = z.object({
  to: z.string().trim().email(),
  note: z.string().trim().max(1000).optional().nullable(),
});

const MAX_EMAIL_PHOTOS = 12;

export async function POST(request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const v = await validateBody(request, bodySchema);
  if (!v.ok) return v.response;

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
    maxPhotos: MAX_EMAIL_PHOTOS,
    hideCosts: true,
  });
  if (!data) {
    return NextResponse.json({ error: "No daily log for this date" }, { status: 404 });
  }

  const pdf = await renderDailyLogPdf(data);
  const dateDisplay = format(new Date(`${date}T12:00:00`), "EEEE, MMMM d, yyyy");
  const sender = `${ctx.session.user.firstName} ${ctx.session.user.lastName}`;

  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#111;max-width:560px;">
    <h2 style="margin:0 0 4px;">Daily Report — ${escapeHtml(job.jobNumber)}</h2>
    <p style="color:#6b7280;margin:0 0 12px;">
      ${escapeHtml(job.title)} · ${dateDisplay}
    </p>
    ${v.data.note ? `<p style="white-space:pre-line;">${escapeHtml(v.data.note)}</p>` : ""}
    <p>The full daily report is attached as a PDF (crew, work performed, and photos).</p>
    <p style="color:#9ca3af;font-size:12px;margin-top:16px;">
      Sent from KNUCO CRM Field Mode by ${escapeHtml(sender)}.
    </p>
  </div>`;

  try {
    const result = await sendEmail({
      to: v.data.to,
      subject: `Daily Report — ${job.jobNumber} — ${date}`,
      html,
      attachments: [
        {
          filename: `daily-report-${job.jobNumber}-${date}.pdf`,
          contentBase64: pdf.toString("base64"),
        },
      ],
    });
    if (!result) {
      return NextResponse.json(
        { error: "Email service is not configured on the server" },
        { status: 503 },
      );
    }
  } catch (err) {
    logger.exception(err, { where: "daily-logs.email", jobId, date });
    return NextResponse.json(
      { error: "Email failed to send — try again or contact the office" },
      { status: 502 },
    );
  }

  await recordAudit({
    actorUserId: ctx.session.user.id,
    entityType: "DailyLog",
    entityId: `${jobId}:${date}`,
    action: "log_email",
    after: { jobId, date, to: v.data.to },
  });

  return NextResponse.json({ ok: true, sentTo: v.data.to });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
