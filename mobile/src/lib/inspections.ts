import type { InspectionDto } from "@crm/mobile-api";

export const TYPE_LABEL: Record<InspectionDto["type"], string> = {
  ROUGH: "Rough",
  FRAMING: "Framing",
  ELECTRICAL: "Electrical",
  PLUMBING: "Plumbing",
  MECHANICAL: "Mechanical",
  ROOFING_IN_PROGRESS: "Roofing in progress",
  ROOFING_FINAL: "Roofing final",
  FINAL: "Final",
  OTHER: "Other",
};

export const RESULT_LABEL: Record<InspectionDto["result"], string> = {
  SCHEDULED: "Booked",
  PASS: "Passed",
  FAIL: "Failed",
  CONDITIONAL: "Passed with conditions",
  CANCELLED: "Cancelled",
};

/** What recording each result will do, before the person confirms (matches the web's wording). */
export const RESULT_EFFECT: Record<"PASS" | "FAIL" | "CONDITIONAL" | "CANCELLED", string> = {
  PASS: "The matching workflow step is completed. A passed final closes the permit.",
  FAIL: "A correction task is created on the job, and the matching workflow step is blocked until it is done.",
  CONDITIONAL: "The matching workflow step is completed and a correction task is created for the conditions.",
  CANCELLED: "The inspection is marked cancelled. Nothing else changes.",
};

/** Booked first (earliest first, undated last), then results (newest first). */
export function splitInspections(list: InspectionDto[]): { booked: InspectionDto[]; done: InspectionDto[] } {
  const booked = list
    .filter((i) => i.result === "SCHEDULED")
    .sort((a, b) => (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999"));
  const done = list
    .filter((i) => i.result !== "SCHEDULED")
    .sort((a, b) => (b.completedAt ?? b.scheduledFor ?? "").localeCompare(a.completedAt ?? a.scheduledFor ?? ""));
  return { booked, done };
}
