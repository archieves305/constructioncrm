import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { canSeeLaborCosts } from "./permissions";
import { toDbDate } from "./dates";
import { getDailyLog } from "./log-service";
import { readFile } from "@/lib/files/storage";
import { logger } from "@/lib/logger";
import type { DailyLogPdfData, DailyLogPdfEntry } from "@/lib/pdf/daily-log";
import { format } from "date-fns";

// Maps one (job, date) log into the daily-report PDF's data shape. Shared by
// the single-day PDF route and the multi-day package route.

const MAX_EMBED_BYTES = 2 * 1024 * 1024;
const EMBEDDABLE_MIME = new Set(["image/jpeg", "image/png"]);

const CATEGORY_LABELS: Record<string, string> = {
  PROGRESS: "Progress",
  BEFORE: "Before",
  AFTER: "After",
  ISSUE: "Issue",
  DAMAGE: "Damage",
  SAFETY: "Safety",
  MATERIAL_DELIVERY: "Material delivery",
  INSPECTION: "Inspection",
  CHANGE_ORDER: "Change order",
  OTHER: "Other",
};

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

function fmtMinutes(minutes: number | null): string {
  if (minutes == null) return "—";
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type JobPdfInfo = {
  jobNumber: string;
  title: string;
  lead: { propertyAddress1: string | null; city: string | null; state: string | null };
};

export async function buildDailyLogPdfData(
  jobId: string,
  date: string,
  job: JobPdfInfo,
  viewerRole: RoleName,
  options: { maxPhotos: number; hideCosts?: boolean },
): Promise<DailyLogPdfData | null> {
  const log = await getDailyLog(jobId, date);
  if (!log) return null;

  // hideCosts forces the cost-free variant regardless of viewer role —
  // used when the PDF leaves the company (emailed daily reports).
  const showCost = !options.hideCosts && canSeeLaborCosts(viewerRole);
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
    ...(showCost ? { rate: Number(e.regularRate), cost: Number(e.totalCost) } : {}),
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

  // Photos for this job+date (log-linked or merely date-tagged).
  const photoRows = await prisma.fieldPhoto.findMany({
    where: { jobId, photoDate: toDbDate(date) },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
    select: {
      storageKey: true,
      fileType: true,
      fileSize: true,
      caption: true,
      category: true,
      areaText: true,
      jobArea: { select: { name: true } },
    },
  });
  const photos: DailyLogPdfData["photos"] = [];
  let omitted = 0;
  for (const p of photoRows) {
    if (
      photos.length >= options.maxPhotos ||
      !EMBEDDABLE_MIME.has(p.fileType) ||
      p.fileSize > MAX_EMBED_BYTES
    ) {
      omitted++;
      continue;
    }
    try {
      const bytes = await readFile(p.storageKey);
      photos.push({
        dataUri: `data:${p.fileType};base64,${bytes.toString("base64")}`,
        caption: p.caption,
        label: [CATEGORY_LABELS[p.category] ?? p.category, p.jobArea?.name ?? p.areaText]
          .filter(Boolean)
          .join(" · "),
      });
    } catch (err) {
      logger.exception(err, { where: "daily-logs.pdf.photo", jobId, date });
      omitted++;
    }
  }

  let signatureDataUri: string | null = null;
  if (log.signatureStorageKey) {
    try {
      const bytes = await readFile(log.signatureStorageKey);
      signatureDataUri = `data:image/png;base64,${bytes.toString("base64")}`;
    } catch (err) {
      logger.exception(err, { where: "daily-logs.pdf.signature", jobId, date });
    }
  }

  const anyChecklist =
    log.safetyToolboxTalk || log.safetyPpeVerified || log.safetyHousekeeping;

  const record = log as unknown as Record<string, string | null>;
  return {
    jobNumber: job.jobNumber,
    jobTitle: job.title,
    jobAddress:
      [job.lead.propertyAddress1, job.lead.city, job.lead.state]
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
    photos,
    photosOmitted: omitted,
    safetyChecklist: anyChecklist
      ? [
          { label: "Toolbox talk held", done: log.safetyToolboxTalk },
          { label: "PPE verified", done: log.safetyPpeVerified },
          { label: "Site housekeeping", done: log.safetyHousekeeping },
        ]
      : [],
    signatureDataUri,
    signedByName: log.signedByName,
    signedAt: log.signedAt ? format(log.signedAt, "MMM d, yyyy h:mm a") : null,
    showCost,
    generatedAt: format(new Date(), "MMM d, yyyy h:mm a"),
  };
}
