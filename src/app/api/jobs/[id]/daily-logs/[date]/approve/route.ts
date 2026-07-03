import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden } from "@/lib/auth/helpers";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { canApproveLog } from "@/lib/labor/permissions";
import { serializeDailyLog } from "@/lib/labor/serialize";
import { getDailyLog } from "@/lib/labor/log-service";
import { recordAudit } from "@/lib/audit/record";
import { buildDailyLogPdfData } from "@/lib/labor/pdf-data";
import { renderDailyLogPdf } from "@/lib/pdf/daily-log";
import { sendEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { format } from "date-fns";

type Context = { params: Promise<{ id: string; date: string }> };

// Approval freezes the log: hours and costs become immutable until an ADMIN
// reopens (the weekly-OT recompute refuses to touch approved entries).
export async function POST(_request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;
  if (!canApproveLog(ctx.session.user.role)) return forbidden();

  const log = await getDailyLog(jobId, date);
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (log.status !== "SUBMITTED") {
    return NextResponse.json(
      { error: `Only submitted logs can be approved (log is ${log.status.toLowerCase()})` },
      { status: 409 },
    );
  }

  await prisma.dailyLog.update({
    where: { id: log.id },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedByUserId: ctx.session.user.id,
    },
  });

  await recordAudit({
    actorUserId: ctx.session.user.id,
    entityType: "DailyLog",
    entityId: log.id,
    action: "log_approve",
    after: { jobId, date },
  });

  // Auto-deliver the approved report (cost-free PDF) to the job's report
  // recipients. Best-effort: a mail hiccup must never fail the approval.
  const delivered: string[] = [];
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        jobNumber: true,
        title: true,
        dailyReportRecipients: true,
        lead: { select: { propertyAddress1: true, city: true, state: true } },
      },
    });
    if (job && job.dailyReportRecipients.length > 0) {
      const data = await buildDailyLogPdfData(jobId, date, job, ctx.session.user.role, {
        maxPhotos: 12,
        hideCosts: true,
      });
      if (data) {
        const pdf = await renderDailyLogPdf(data);
        const dateDisplay = format(new Date(`${date}T12:00:00`), "EEEE, MMMM d, yyyy");
        const html = `
        <div style="font-family:Helvetica,Arial,sans-serif;color:#111;max-width:560px;">
          <h2 style="margin:0 0 4px;">Daily Report — ${job.jobNumber}</h2>
          <p style="color:#6b7280;margin:0 0 12px;">${job.title} · ${dateDisplay}</p>
          <p>The approved daily report is attached (crew, work performed, and photos).</p>
          <p style="color:#9ca3af;font-size:12px;margin-top:16px;">Sent automatically by KNUCO CRM on approval.</p>
        </div>`;
        for (const to of job.dailyReportRecipients) {
          try {
            const result = await sendEmail({
              to,
              subject: `Daily Report — ${job.jobNumber} — ${date}`,
              html,
              attachments: [
                {
                  filename: `daily-report-${job.jobNumber}-${date}.pdf`,
                  contentBase64: pdf.toString("base64"),
                },
              ],
            });
            if (result) {
              delivered.push(to);
              await recordAudit({
                actorUserId: ctx.session.user.id,
                entityType: "DailyLog",
                entityId: log.id,
                action: "log_email",
                after: { jobId, date, to, trigger: "auto-on-approve" },
              });
            }
          } catch (err) {
            logger.exception(err, { where: "daily-logs.approve.autoemail", jobId, date, to });
          }
        }
      }
    }
  } catch (err) {
    logger.exception(err, { where: "daily-logs.approve.autoemail", jobId, date });
  }

  const fresh = await getDailyLog(jobId, date);
  return NextResponse.json({
    ...serializeDailyLog(fresh!, ctx.session.user.role),
    reportDelivered: delivered,
  });
}
