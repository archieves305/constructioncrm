import { STATUS, type InspectionDto } from "@crm/mobile-api";

/** Labels from the shared status registry, so a phone and the web name an inspection the same way. */
export const TYPE_LABEL = Object.fromEntries(
  Object.entries(STATUS.inspectionType).map(([k, v]) => [k, v.label]),
) as Record<InspectionDto["type"], string>;

export const RESULT_LABEL = Object.fromEntries(
  Object.entries(STATUS.inspectionResult).map(([k, v]) => [k, v.label]),
) as Record<InspectionDto["result"], string>;

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
