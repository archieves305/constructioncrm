import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { fromDbDate, addDays, toDbDate } from "@/lib/labor/dates";
import { sendEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { format } from "date-fns";

// End-of-day nudge (intended ~5pm jobsite time): each crew lead with
// unsubmitted DRAFT logs from the last 3 days gets ONE email listing them.
// Recipient = the log's manager (fallback: creator). Idempotent per run;
// runs daily so at most one nudge a day.
//
// Auth mirrors the other cron routes: `x-cron-secret` must match CRON_SECRET.
export async function POST(request: NextRequest) {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 503 },
    );
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const windowStart = addDays(today, -3);

  const drafts = await prisma.dailyLog.findMany({
    where: {
      status: "DRAFT",
      logDate: { gte: toDbDate(windowStart), lte: toDbDate(today) },
    },
    select: {
      logDate: true,
      returnNote: true,
      manager: { select: { id: true, email: true, firstName: true, isActive: true } },
      createdBy: { select: { id: true, email: true, firstName: true, isActive: true } },
      job: { select: { id: true, jobNumber: true, title: true } },
      laborEntries: { select: { isAbsent: true } },
    },
    orderBy: { logDate: "asc" },
  });

  type Item = { date: string; job: string; jobId: string; crew: number; returned: boolean };
  const byUser = new Map<string, { email: string; firstName: string; items: Item[] }>();
  for (const log of drafts) {
    const owner = log.manager?.isActive ? log.manager : log.createdBy;
    if (!owner?.isActive || !owner.email) continue;
    let bucket = byUser.get(owner.id);
    if (!bucket) {
      bucket = { email: owner.email, firstName: owner.firstName, items: [] };
      byUser.set(owner.id, bucket);
    }
    bucket.items.push({
      date: fromDbDate(log.logDate),
      job: `${log.job.jobNumber} — ${log.job.title}`,
      jobId: log.job.id,
      crew: log.laborEntries.filter((e) => !e.isAbsent).length,
      returned: Boolean(log.returnNote),
    });
  }

  let sent = 0;
  const failures: string[] = [];
  for (const [, u] of byUser) {
    const rows = u.items
      .map((i) => {
        const label = format(new Date(`${i.date}T12:00:00`), "EEE, MMM d");
        const link = `${env.NEXTAUTH_URL}/field/jobs/${i.jobId}/daily/${i.date}`;
        return `<li style="margin-bottom:6px;">
          <a href="${link}">${label} — ${escapeHtml(i.job)}</a>
          (${i.crew} crew${i.returned ? " · <strong style='color:#b91c1c;'>returned by the office</strong>" : ""})
        </li>`;
      })
      .join("");
    const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;color:#111;max-width:560px;">
      <h2 style="margin:0 0 8px;">Unsubmitted daily logs</h2>
      <p>Hi ${escapeHtml(u.firstName)} — these daily reports are still drafts:</p>
      <ul>${rows}</ul>
      <p>Open each one in Field Mode and hit <strong>Submit daily report</strong> so the office can approve hours.</p>
    </div>`;
    try {
      const result = await sendEmail({
        to: u.email,
        subject: `Reminder: ${u.items.length} daily log${u.items.length === 1 ? "" : "s"} not submitted`,
        html,
      });
      if (result) sent++;
      else failures.push(`${u.email}: email not configured`);
    } catch (err) {
      failures.push(u.email);
      logger.exception(err, { where: "cron.field-log-reminders", to: u.email });
    }
  }

  logger.info("field-log-reminders cron done", {
    drafts: drafts.length,
    leads: byUser.size,
    sent,
    failures: failures.length,
  });
  return NextResponse.json({ drafts: drafts.length, leads: byUser.size, sent, failures });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
