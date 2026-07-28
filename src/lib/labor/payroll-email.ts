import { prisma } from "@/lib/db/prisma";
import { addDays, fromDbDate, toDbDate, weekStartOf } from "./dates";
import { getLaborSettings } from "./settings";
import { buildPayrollRows, payrollRowsToCsv, type PayrollRow } from "./payroll";
import { sendEmail } from "@/lib/email/send";
import { recordAudit } from "@/lib/audit/record";

// One code path for "email the week's payroll to the bookkeeper" — used by
// the Field Mode button and the Friday cron. Recipient is always the
// ADMIN-configured LaborSettings.bookkeeperEmail. Respects the
// payrollApprovedOnly toggle (only hours on APPROVED logs count).

export type PayrollEmailResult =
  | { ok: true; weekStart: string; workers: number; sentTo: string; missingRates: string[] }
  | { ok: false; status: number; reason: string };

export async function sendWeeklyPayrollEmail(input: {
  weekStart: string; // any date in the target week
  triggeredByUserId: string | null; // null = cron
  triggeredByLabel: string; // "Jane Smith" or "Friday schedule"
}): Promise<PayrollEmailResult> {
  const settings = await getLaborSettings();
  if (!settings.bookkeeperEmail) {
    return {
      ok: false,
      status: 409,
      reason: "No bookkeeper email is configured — ask an admin to set it under Labor Reports",
    };
  }

  const weekStart = weekStartOf(input.weekStart, settings.weekStartsOn);
  const weekEnd = addDays(weekStart, 7);

  const entries = await prisma.dailyLaborEntry.findMany({
    where: {
      isAbsent: false,
      workDate: { gte: toDbDate(weekStart), lt: toDbDate(weekEnd) },
      ...(settings.payrollApprovedOnly ? { dailyLog: { status: "APPROVED" } } : {}),
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
          payType: true,
          entityName: true,
          crew: { select: { name: true } },
        },
      },
    },
  });
  if (entries.length === 0) {
    return {
      ok: false,
      status: 400,
      reason: settings.payrollApprovedOnly
        ? `No hours on APPROVED logs for the week of ${weekStart}`
        : `No hours recorded for the week of ${weekStart}`,
    };
  }

  const rows = buildPayrollRows(
    entries.map((e) => ({
      personnelId: e.personnelId,
      name: `${e.personnel.lastName}, ${e.personnel.firstName}`,
      employmentType: e.personnel.employmentType,
      payType: e.personnel.payType,
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
  const missingRates = [
    ...new Set(rows.filter((r) => r.regularRate === 0).map((r) => r.name)),
  ];

  const html = buildHtml(rows, weekStart, {
    triggeredByLabel: input.triggeredByLabel,
    approvedOnly: settings.payrollApprovedOnly,
    missingRates,
  });

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
    return { ok: false, status: 503, reason: "Email service is not configured on the server" };
  }

  await recordAudit({
    actorUserId: input.triggeredByUserId,
    entityType: "PayrollExport",
    entityId: weekStart,
    action: "payroll_email",
    after: {
      weekStart,
      to: settings.bookkeeperEmail,
      workers: rows.length,
      trigger: input.triggeredByLabel,
      approvedOnly: settings.payrollApprovedOnly,
      missingRates,
    },
  });

  return {
    ok: true,
    weekStart,
    workers: rows.length,
    sentTo: settings.bookkeeperEmail,
    missingRates,
  };
}

function buildHtml(
  rows: PayrollRow[],
  weekStart: string,
  meta: { triggeredByLabel: string; approvedOnly: boolean; missingRates: string[] },
): string {
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

  return `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#111;max-width:640px;">
    <h2 style="margin:0 0 4px;">Weekly labor hours — ${weekStart} to ${weekEndDisplay}</h2>
    <p style="color:#6b7280;margin:0 0 16px;">
      Sent from KNUCO CRM by ${escapeHtml(meta.triggeredByLabel)}.
      ${meta.approvedOnly ? "Only hours on office-approved logs are included." : ""}
      The attached CSV has the same data with per-day columns.
    </p>
    ${
      meta.missingRates.length
        ? `<p style="background:#fef3c7;border:1px solid #fcd34d;padding:8px 12px;border-radius:6px;">
             <strong>Missing rates:</strong> ${meta.missingRates.map(escapeHtml).join(", ")}
             — their gross shows $0.00 until the office sets an hourly rate.
           </p>`
        : ""
    }
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
      Rates and gross reflect what was snapshotted on each day's entries.
    </p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
