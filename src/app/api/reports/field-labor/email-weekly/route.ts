import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { addDays, fromDbDate, isIsoDate, toDbDate, weekStartOf } from "@/lib/labor/dates";
import { getLaborSettings } from "@/lib/labor/settings";
import { buildPayrollRows, payrollRowsToCsv } from "@/lib/labor/payroll";
import { sendEmail } from "@/lib/email/send";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";

// "Email weekly hours to the bookkeeper" — triggerable from Field Mode.
// The recipient is the ADMIN-configured LaborSettings.bookkeeperEmail, never
// caller-supplied, so a crew lead can *send* payroll data without being able
// to *see* it or redirect it. Every send is audited.
const TRIGGER_ROLES = new Set(["ADMIN", "MANAGER", "OFFICE_STAFF", "CREW_LEAD"]);

const bodySchema = z.object({
  weekStart: z.string().refine(isIsoDate, "expected YYYY-MM-DD"),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!TRIGGER_ROLES.has(session.user.role)) return forbidden();

  const v = await validateBody(request, bodySchema);
  if (!v.ok) return v.response;

  const settings = await getLaborSettings();
  if (!settings.bookkeeperEmail) {
    return NextResponse.json(
      { error: "No bookkeeper email is configured — ask an admin to set it under Labor Reports" },
      { status: 409 },
    );
  }

  const weekStart = weekStartOf(v.data.weekStart, settings.weekStartsOn);
  const weekEnd = addDays(weekStart, 7);

  const entries = await prisma.dailyLaborEntry.findMany({
    where: {
      isAbsent: false,
      workDate: { gte: toDbDate(weekStart), lt: toDbDate(weekEnd) },
    },
    select: {
      personnelId: true,
      workDate: true,
      regularHours: true,
      otHours: true,
      regularRate: true,
      otRate: true,
      totalCost: true,
      personnel: {
        select: {
          firstName: true,
          lastName: true,
          employmentType: true,
          entityName: true,
          crew: { select: { name: true } },
        },
      },
    },
  });
  if (entries.length === 0) {
    return badRequest(`No hours recorded for the week of ${weekStart}`);
  }

  const rows = buildPayrollRows(
    entries.map((e) => ({
      personnelId: e.personnelId,
      name: `${e.personnel.lastName}, ${e.personnel.firstName}`,
      employmentType: e.personnel.employmentType,
      entity: e.personnel.crew?.name ?? e.personnel.entityName,
      workDate: fromDbDate(e.workDate),
      regularHours: Number(e.regularHours),
      otHours: Number(e.otHours),
      regularRate: Number(e.regularRate),
      otRate: Number(e.otRate),
      totalCost: Number(e.totalCost),
    })),
    weekStart,
  );
  const csv = payrollRowsToCsv(rows, weekStart);

  const totalReg = round2(rows.reduce((s, r) => s + r.regularHours, 0));
  const totalOt = round2(rows.reduce((s, r) => s + r.otHours, 0));
  const totalGross = round2(rows.reduce((s, r) => s + r.gross, 0));
  const weekEndDisplay = addDays(weekStart, 6);

  const tableRows = rows
    .map(
      (r) => `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.name)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.entity || "—")}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${r.regularHours}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${r.otHours}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">$${r.regularRate.toFixed(2)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">$${r.gross.toFixed(2)}</td>
      </tr>`,
    )
    .join("");

  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#111;max-width:640px;">
    <h2 style="margin:0 0 4px;">Weekly labor hours — ${weekStart} to ${weekEndDisplay}</h2>
    <p style="color:#6b7280;margin:0 0 16px;">
      Sent from KNUCO CRM Field Mode by ${escapeHtml(session.user.firstName)} ${escapeHtml(session.user.lastName)}.
      The attached CSV has the same data with per-day columns.
    </p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <thead>
        <tr style="text-align:left;color:#374151;">
          <th style="padding:4px 8px;border-bottom:2px solid #cbd5e1;">Worker</th>
          <th style="padding:4px 8px;border-bottom:2px solid #cbd5e1;">Company</th>
          <th style="padding:4px 8px;border-bottom:2px solid #cbd5e1;text-align:right;">Reg</th>
          <th style="padding:4px 8px;border-bottom:2px solid #cbd5e1;text-align:right;">OT</th>
          <th style="padding:4px 8px;border-bottom:2px solid #cbd5e1;text-align:right;">Rate</th>
          <th style="padding:4px 8px;border-bottom:2px solid #cbd5e1;text-align:right;">Gross</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
      <tfoot>
        <tr style="font-weight:bold;">
          <td style="padding:6px 8px;" colspan="2">Total — ${rows.length} worker${rows.length === 1 ? "" : "s"}</td>
          <td style="padding:6px 8px;text-align:right;">${totalReg}</td>
          <td style="padding:6px 8px;text-align:right;">${totalOt}</td>
          <td></td>
          <td style="padding:6px 8px;text-align:right;">$${totalGross.toLocaleString()}</td>
        </tr>
      </tfoot>
    </table>
    <p style="color:#9ca3af;font-size:12px;margin-top:16px;">
      Rates and gross reflect what was snapshotted on each day's approved
      entries. Missing rates appear as $0.00 — check the Personnel records.
    </p>
  </div>`;

  try {
    const result = await sendEmail({
      to: settings.bookkeeperEmail,
      subject: `KNUCO weekly labor hours — week of ${weekStart}`,
      html,
      attachments: [
        {
          filename: `payroll-week-${weekStart}.csv`,
          contentBase64: Buffer.from(`﻿${csv}`, "utf8").toString("base64"),
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
    logger.exception(err, { where: "field-labor.email-weekly", weekStart });
    return NextResponse.json(
      { error: "Email failed to send — try again or contact the office" },
      { status: 502 },
    );
  }

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "PayrollExport",
    entityId: weekStart,
    action: "payroll_email",
    after: { weekStart, to: settings.bookkeeperEmail, workers: rows.length },
  });

  return NextResponse.json({
    ok: true,
    weekStart,
    workers: rows.length,
    sentTo: settings.bookkeeperEmail,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
