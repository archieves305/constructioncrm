import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { canSeeLaborCosts } from "@/lib/labor/permissions";
import { getDailyLog } from "@/lib/labor/log-service";
import {
  renderDailyLogPdf,
  type DailyLogPdfData,
  type DailyLogPdfEntry,
} from "@/lib/pdf/daily-log";
import { format } from "date-fns";

type Context = { params: Promise<{ id: string; date: string }> };

function fmtMinutes(minutes: number | null): string {
  if (minutes == null) return "—";
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

const SECTION_LABELS: [string, string][] = [
  ["workPerformed", "Work Performed"],
  ["areasWorked", "Areas Worked"],
  ["materialsDelivered", "Materials Delivered"],
  ["equipmentUsed", "Equipment Used"],
  ["subcontractorsOnsite", "Subcontractors Onsite"],
  ["inspectionsNotes", "Inspections"],
  ["delays", "Delays"],
  ["safetyIssues", "Safety"],
  ["changeOrderItems", "Change Order Items Observed"],
  ["ownerInstructions", "Owner / Client Instructions"],
  ["officeFollowUps", "Office Follow-Ups"],
  ["tomorrowPlan", "Plan for Tomorrow"],
  ["notes", "General Notes"],
];

export async function GET(_request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  const [log, job] = await Promise.all([
    getDailyLog(jobId, date),
    prisma.job.findUnique({
      where: { id: jobId },
      select: {
        jobNumber: true,
        title: true,
        lead: { select: { propertyAddress1: true, city: true, state: true } },
      },
    }),
  ]);
  if (!log || !job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const showCost = canSeeLaborCosts(ctx.session.user.role);
  const present = log.laborEntries.filter((e) => !e.isAbsent);

  const entries: DailyLogPdfEntry[] = log.laborEntries.map((e) => ({
    name: `${e.personnel.lastName}, ${e.personnel.firstName}`,
    trade: e.trade,
    isAbsent: e.isAbsent,
    isLate: e.isLate,
    leftEarly: e.leftEarly,
    start: e.isAbsent ? "" : fmtMinutes(e.startMinutes),
    end: e.isAbsent ? "" : fmtMinutes(e.endMinutes),
    breakMinutes: e.breakMinutes,
    regularHours: Number(e.regularHours),
    otHours: Number(e.otHours),
    ...(showCost
      ? { rate: Number(e.regularRate), cost: Number(e.totalCost) }
      : {}),
    notes: e.notes,
  }));

  const weatherParts = [
    log.weatherSummary,
    log.weatherTempHighF != null && log.weatherTempLowF != null
      ? `${log.weatherTempLowF}–${log.weatherTempHighF}°F`
      : null,
    log.weatherWindMph != null ? `wind ${log.weatherWindMph} mph` : null,
    log.weatherPrecipIn != null && Number(log.weatherPrecipIn) > 0
      ? `${log.weatherPrecipIn}" precip`
      : null,
  ].filter(Boolean);

  const record = log as unknown as Record<string, string | null>;
  const data: DailyLogPdfData = {
    jobNumber: job.jobNumber,
    jobTitle: job.title,
    jobAddress: [job.lead.propertyAddress1, job.lead.city, job.lead.state]
      .filter(Boolean)
      .join(", ") || null,
    date: format(new Date(`${date}T12:00:00`), "EEEE, MMMM d, yyyy"),
    status:
      log.status === "APPROVED"
        ? `Approved${log.approvedAt ? ` ${format(log.approvedAt, "MMM d, h:mm a")}` : ""}`
        : log.status === "SUBMITTED"
          ? "Submitted — pending approval"
          : "Draft",
    managerName: log.manager
      ? `${log.manager.firstName} ${log.manager.lastName}`
      : null,
    weather: weatherParts.length ? weatherParts.join(" · ") : null,
    entries,
    totals: {
      workers: new Set(present.map((e) => e.personnelId)).size,
      regularHours: round2(present.reduce((s, e) => s + Number(e.regularHours), 0)),
      otHours: round2(present.reduce((s, e) => s + Number(e.otHours), 0)),
      ...(showCost
        ? { cost: round2(present.reduce((s, e) => s + Number(e.totalCost), 0)) }
        : {}),
    },
    sections: SECTION_LABELS.flatMap(([key, label]) => {
      const text = record[key];
      return text?.trim() ? [{ label, text: text.trim() }] : [];
    }),
    showCost,
    generatedAt: format(new Date(), "MMM d, yyyy h:mm a"),
  };

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
