import type { WorkflowPermitStatus } from "@/generated/prisma/client";

/**
 * Pure intake helpers: the answers on the intake form → the template's
 * scope toggles and a suggested permit status. The person can still change
 * everything before creating the case.
 */

export type IntakeCategory = { key: string; defaultConstructionRequired: boolean; defaultPermitRequirement: WorkflowPermitStatus };

export type IntakeAnswers = {
  categories: IntakeCategory[];
  hearingDate: Date | null;
  hearingRequired?: boolean;
  dailyFine: number | null;
  initialFine?: number | null;
  lienRecorded: boolean;
  emergency: boolean;
  constructionRequired?: boolean | null;
  appeal?: boolean;
};

export type IntakeDefaults = {
  scopeToggles: Record<string, boolean>;
  permitSuggestion: WorkflowPermitStatus;
  constructionRequired: boolean;
  hearingRequired: boolean;
};

export function toggleDefaultsFromIntake(a: IntakeAnswers): IntakeDefaults {
  const constructionRequired = a.constructionRequired ?? a.categories.some((c) => c.defaultConstructionRequired);
  const hearingRequired = a.hearingRequired ?? a.hearingDate !== null;
  const finesAccruing = (a.dailyFine ?? 0) > 0 || (a.initialFine ?? 0) > 0;
  // Any category that usually needs a permit suggests REQUIRED; only when
  // every category says "not required" do we suggest that; otherwise leave it undecided.
  const reqs = a.categories.map((c) => c.defaultPermitRequirement);
  const permitSuggestion: WorkflowPermitStatus = reqs.includes("REQUIRED")
    ? "REQUIRED"
    : reqs.length > 0 && reqs.every((r) => r === "NOT_REQUIRED")
      ? "NOT_REQUIRED"
      : "UNDETERMINED";
  return {
    scopeToggles: {
      construction_required: constructionRequired,
      hearing_required: hearingRequired,
      fines_accruing: finesAccruing,
      lien_recorded: a.lienRecorded,
      emergency: a.emergency,
      appeal: a.appeal ?? false,
    },
    permitSuggestion,
    constructionRequired,
    hearingRequired,
  };
}
