import type { Tone } from "@/lib/ui/tones";
import { describeDaysRemaining } from "./dates";
import type { CaseState } from "./state";

export type CaseAlert = { key: string; tone: Tone; title: string; body?: string; tab?: string };

/**
 * The warning banners on a case page, from the derived state and a few
 * figures. Pure so the same list can be tested and reused by the list view.
 */
export function deriveCaseAlerts(
  c: {
    state: CaseState;
    currentDeadline: Date | null;
    nextHearingAt: Date | null;
    nextInspectionAt: Date | null;
    reinspectionRequestedAt: Date | null;
    fines: { accruing: boolean; dailyFine: string; accrued: string; days: number; officialBalance: { amount: string } | null };
    noticeType: string | null;
    closureOverrideReason: string | null;
  },
  now: Date,
): CaseAlert[] {
  const out: CaseAlert[] = [];
  const f = c.state.flags;
  if (f.includes("overdue") && c.currentDeadline) {
    out.push({ key: "overdue", tone: "danger", title: `Compliance deadline ${describeDaysRemaining(c.currentDeadline, now)}`, body: "Request an extension or submit proof of correction and a reinspection request.", tab: "overview" });
  } else if (f.includes("due_soon") && c.currentDeadline) {
    out.push({ key: "due-soon", tone: "warning", title: `Compliance deadline ${describeDaysRemaining(c.currentDeadline, now)}`, tab: "overview" });
  }
  if (c.fines.accruing) {
    out.push({
      key: "fines-accruing",
      tone: "warning",
      title: `Fines accruing — $${Number(c.fines.dailyFine).toLocaleString()} per day`,
      body: `${c.fines.days} day${c.fines.days === 1 ? "" : "s"} so far, $${Number(c.fines.accrued).toLocaleString()} estimated. Only an official stop date recorded on Fines & Liens stops this estimate.`,
      tab: "fines",
    });
  }
  if (f.includes("lien_recorded")) out.push({ key: "lien", tone: "warning", title: "A lien is recorded on the property", tab: "fines" });
  if (f.includes("hearing_scheduled") && c.nextHearingAt) {
    out.push({ key: "hearing", tone: "info", title: `Hearing ${describeDaysRemaining(c.nextHearingAt, now)}`, body: "Assign the attendee and prepare the evidence package.", tab: "hearings" });
  }
  if (f.includes("inspection_scheduled") && c.nextInspectionAt) {
    out.push({ key: "inspection", tone: "info", title: `Agency inspection ${describeDaysRemaining(c.nextInspectionAt, now)}`, tab: "inspections" });
  }
  if (f.includes("blocked_work")) {
    out.push({
      key: "blocked-work",
      tone: "danger",
      title: c.noticeType === "STOP_WORK_ORDER" ? "Stop-work order — no work until it is lifted" : "Corrective work is blocked",
      body: f.includes("permit_undetermined") ? "The permit requirement has not been decided." : f.includes("permit_pending") ? "A permit is required and not yet issued on the linked job." : "A blocking workflow step is open.",
      tab: "workflow",
    });
  } else if (f.includes("permit_pending")) {
    out.push({ key: "permit-pending", tone: "warning", title: "Permit required — not yet issued", tab: "permits" });
  } else if (f.includes("permit_undetermined") && c.state.status === "ACTIVE") {
    out.push({ key: "permit-undetermined", tone: "warning", title: "Permit requirement not decided", tab: "workflow" });
  }
  if (f.includes("awaiting_agency") && c.reinspectionRequestedAt) {
    out.push({ key: "awaiting-agency", tone: "info", title: `Awaiting agency confirmation — reinspection requested ${c.reinspectionRequestedAt.toLocaleDateString()}`, tab: "inspections" });
  }
  if (f.includes("extension_pending")) out.push({ key: "extension", tone: "info", title: "Extension request pending with the agency", tab: "overview" });
  if (c.closureOverrideReason) out.push({ key: "closure-override", tone: "neutral", title: "Closed without agency confirmation", body: c.closureOverrideReason });
  return out;
}
