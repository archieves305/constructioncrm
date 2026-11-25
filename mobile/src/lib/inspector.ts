import type { QualityInspectionDto } from "@crm/mobile-api";

/**
 * AI Field Inspector on the phone. Pure. Boxes come from the CRM in the
 * stored photo's pixels; the phone draws the photo "contain"-fitted in a
 * frame, so a box is scaled and offset the same way.
 */
export type Box = { x1: number; y1: number; x2: number; y2: number };
export type Finding = QualityInspectionDto["findings"][number];
export type Photo = QualityInspectionDto["photos"][number];

export function boxOnScreen(b: Box, photo: { width: number; height: number }, frame: { width: number; height: number }): { left: number; top: number; width: number; height: number } {
  const scale = Math.min(frame.width / photo.width, frame.height / photo.height);
  const offX = (frame.width - photo.width * scale) / 2;
  const offY = (frame.height - photo.height * scale) / 2;
  return { left: offX + b.x1 * scale, top: offY + b.y1 * scale, width: (b.x2 - b.x1) * scale, height: (b.y2 - b.y1) * scale };
}

export type Tone = "danger" | "warning" | "info" | "neutral";
export function severityTone(sev: string): Tone {
  return sev === "CRITICAL" ? "danger" : sev === "MAJOR" ? "warning" : sev === "MINOR" ? "info" : "neutral";
}

export const SEVERITY_TEXT: Record<string, string> = { CRITICAL: "Critical", MAJOR: "Major", MINOR: "Minor", COSMETIC: "Cosmetic" };
export const VERDICT_TEXT: Record<string, string> = { looks_complete: "Looks complete", issues_found: "Issues found", cannot_tell: "Can't tell from the photos" };
export const KIND_TEXT: Record<string, string> = {
  OBSERVED: "Seen",
  SUSPECTED: "Suspected",
  DOCUMENTATION: "Needs a photo",
  SCOPE: "Scope",
  PHYSICAL_CHECK: "Check in person",
  CANNOT_DETERMINE: "Can't tell",
};
export const DISMISS_TEXT: Record<string, string> = {
  false_positive: "Not a real problem",
  not_this_contractor: "Not this contractor's work",
  out_of_scope: "Outside the scope",
  duplicate: "Already recorded",
  other: "Other",
};

/** The kinds offered first on the phone; the rest stay one tap away. */
export const PHONE_KINDS = ["COMPLETION", "TURNOVER", "QUICK", "MAINTENANCE", "INTERIOR", "EXTERIOR", "PROGRESS", "PRE_CONCEALMENT", "WARRANTY", "TRADE"] as const;
export const PHONE_KIND_TEXT: Record<(typeof PHONE_KINDS)[number], string> = {
  COMPLETION: "Contractor done",
  TURNOVER: "Rent-ready",
  QUICK: "Quick look",
  MAINTENANCE: "Repair",
  INTERIOR: "Interior",
  EXTERIOR: "Exterior",
  PROGRESS: "Progress",
  PRE_CONCEALMENT: "Before it's covered",
  WARRANTY: "Callback",
  TRADE: "One trade",
};

/** What an area's tile says: photos waiting, findings to look at, or the AI's word. */
export function areaLine(area: QualityInspectionDto["areas"][number], photos: readonly Photo[], findings: readonly Finding[]): string {
  const mine = photos.filter((p) => p.areaId === area.id);
  if (!mine.length) return "No photos yet";
  const busy = mine.filter((p) => p.state === "waiting" || p.state === "analysing").length;
  if (busy) return `${mine.length} photo${mine.length === 1 ? "" : "s"} · analysing ${busy}`;
  const toReview = findings.filter((f) => f.areaId === area.id && f.review === "PROPOSED").length;
  if (toReview) return `${toReview} to look at`;
  const open = findings.filter((f) => f.areaId === area.id && f.review === "CONFIRMED" && !f.resolved).length;
  if (open) return `${open} to fix`;
  return area.verdict ? VERDICT_TEXT[area.verdict] ?? area.verdict : `${mine.length} photo${mine.length === 1 ? "" : "s"}`;
}

/** Findings for one area, worst first, the dismissed last. */
export function areaFindings(findings: readonly Finding[], areaId: string): Finding[] {
  const rank: Record<string, number> = { CRITICAL: 0, MAJOR: 1, MINOR: 2, COSMETIC: 3 };
  return findings
    .filter((f) => f.areaId === areaId)
    .sort((a, b) => Number(a.review === "DISMISSED") - Number(b.review === "DISMISSED") || (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}
