import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { fromDbDate, addDays, toDbDate } from "@/lib/labor/dates";
import { sendEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { format } from "date-fns";

// Morning office digest (intended weekday mornings): one email to each
// active ADMIN/MANAGER covering (1) submitted logs awaiting approval,
// (2) drafts stuck >48h, and (3) workers whose recent hours computed at a
// $0 rate. Sends nothing when all three lists are empty.
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
  const staleCutoff = addDays(today, -2);

  const [awaiting, staleDrafts, zeroRateEntries] = await Promise.all([
    prisma.dailyLog.findMany({
      where: { status: "SUBMITTED" },
      select: {
        logDate: true,
        submittedAt: true,
        job: { select: { id: true, jobNumber: true, title: true } },
        manager: { select: { firstName: true, lastName: true } },
        laborEntries: { select: { isAbsent: true, totalHours: true } },
      },
      orderBy: { submittedAt: "asc" },
    }),
    prisma.dailyLog.findMany({
      where: { status: "DRAFT", logDate: { lt: toDbDate(staleCutoff) } },
      select: {
        logDate: true,
        job: { select: { jobNumber: true, title: true } },
        manager: { select: { firstName: true, lastName: true } },
      },
      orderBy: { logDate: "asc" },
      take: 20,
    }),
    prisma.dailyLaborEntry.findMany({
      where: {
        isAbsent: false,
        regularRate: 0,
        totalHours: { gt: 0 },
        workDate: { gte: toDbDate(addDays(today, -7)) },
      },
      select: {
        personnel: { select: { id: true, firstName: true, lastName: true } },
      },
      distinct: ["personnelId"],
    }),
  ]);

  if (awaiting.length === 0 && staleDrafts.length === 0 && zeroRateEntries.length === 0) {
    logger.info("field-log-digest cron: nothing to report");
    return NextResponse.json({ sent: 0, skipped: true });
  }

  const recipients = await prisma.user.findMany({
    where: { isActive: true, role: { name: { in: ["ADMIN", "MANAGER"] } } },
    select: { email: true, firstName: true },
  });

  const fmtDate = (d: Date) => format(new Date(`${fromDbDate(d)}T12:00:00`), "EEE, MMM d");
  const section = (title: string, body: string) =>
    body ? `<h3 style="margin:16px 0 6px;">${title}</h3>${body}` : "";

  const awaitingHtml = awaiting
    .map((l) => {
      const crew = l.laborEntries.filter((e) => !e.isAbsent).length;
      const hours = round2(
        l.laborEntries.reduce((s, e) => s + Number(e.totalHours), 0),
      );
      const link = `${env.APP_BASE_URL}/jobs/${l.job.id}/daily-logs/${fromDbDate(l.logDate)}`;
      const lead = l.manager ? ` · ${l.manager.firstName} ${l.manager.lastName}` : "";
      return `<li style="margin-bottom:4px;"><a href="${link}">${fmtDate(l.logDate)} — ${escapeHtml(`${l.job.jobNumber} ${l.job.title}`)}</a> (${crew} crew, ${hours}h${lead})</li>`;
    })
    .join("");

  const staleHtml = staleDrafts
    .map(
      (l) =>
        `<li style="margin-bottom:4px;">${fmtDate(l.logDate)} — ${escapeHtml(`${l.job.jobNumber} ${l.job.title}`)}${l.manager ? ` · ${l.manager.firstName} ${l.manager.lastName}` : ""}</li>`,
    )
    .join("");

  const zeroHtml = zeroRateEntries
    .map(
      (e) =>
        `<li style="margin-bottom:4px;"><a href="${env.APP_BASE_URL}/personnel/${e.personnel.id}">${escapeHtml(`${e.personnel.lastName}, ${e.personnel.firstName}`)}</a></li>`,
    )
    .join("");

  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#111;max-width:560px;">
    <h2 style="margin:0 0 4px;">Field ops digest — ${format(new Date(`${today}T12:00:00`), "EEEE, MMM d")}</h2>
    ${section(`Awaiting approval (${awaiting.length})`, awaitingHtml ? `<ul>${awaitingHtml}</ul>` : "")}
    ${section(`Drafts older than 48h (${staleDrafts.length})`, staleHtml ? `<ul>${staleHtml}</ul>` : "")}
    ${section(`Workers with hours at a $0 rate (${zeroRateEntries.length})`, zeroHtml ? `<ul>${zeroHtml}</ul>` : "")}
    <p style="color:#9ca3af;font-size:12px;margin-top:16px;">
      Approve logs at ${env.APP_BASE_URL}/field-logs · Sent automatically each weekday morning.
    </p>
  </div>`;

  let sent = 0;
  for (const r of recipients) {
    try {
      const result = await sendEmail({
        to: r.email,
        subject: `Field ops digest: ${awaiting.length} awaiting approval`,
        html,
      });
      if (result) sent++;
    } catch (err) {
      logger.exception(err, { where: "cron.field-log-digest", to: r.email });
    }
  }

  logger.info("field-log-digest cron done", {
    awaiting: awaiting.length,
    stale: staleDrafts.length,
    zeroRate: zeroRateEntries.length,
    sent,
  });
  return NextResponse.json({
    awaiting: awaiting.length,
    stale: staleDrafts.length,
    zeroRate: zeroRateEntries.length,
    sent,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
