import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { canViewPayroll, getFieldGrants } from "@/lib/labor/permissions";
import { addDays, fromDbDate, isIsoDate, toDbDate, weekStartOf } from "@/lib/labor/dates";
import { getLaborSettings } from "@/lib/labor/settings";
import { buildPayrollRows, payrollRowsToCsv } from "@/lib/labor/payroll";
import { recordAudit } from "@/lib/audit/record";

// Payroll CSV for one payroll week. Authoritative math happens server-side
// from stored entry snapshots; every export is audited.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const grants = await getFieldGrants(session.user.id);
  if (!canViewPayroll(session.user.role, grants)) return forbidden();

  const weekStartParam = request.nextUrl.searchParams.get("weekStart");
  if (!weekStartParam || !isIsoDate(weekStartParam)) {
    return badRequest("weekStart is required (YYYY-MM-DD)");
  }
  const settings = await getLaborSettings();
  // Snap to the configured week boundary so a mid-week date still exports
  // the whole payroll week.
  const weekStart = weekStartOf(weekStartParam, settings.weekStartsOn);
  const weekEnd = addDays(weekStart, 7);

  const entries = await prisma.dailyLaborEntry.findMany({
    where: {
      isAbsent: false,
      workDate: { gte: toDbDate(weekStart), lt: toDbDate(weekEnd) },
      ...(settings.payrollApprovedOnly ? { dailyLog: { status: "APPROVED" as const } } : {}),
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

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "PayrollExport",
    entityId: weekStart,
    action: "payroll_export",
    after: { weekStart, workers: rows.length },
  });

  const csv = payrollRowsToCsv(rows, weekStart);
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-week-${weekStart}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
