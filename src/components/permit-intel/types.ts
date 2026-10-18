import type { InspectionStep, PermitInspection, PermitRecord } from "@/components/permits/shared";
import type { TaskListItem } from "@/components/tasks/types";
import type { JobLabelInput } from "@/lib/labels/job";

/** `GET /api/permits/[id]` as the permit page reads it. */
export type PermitFile = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  category: string;
  createdAt: string;
  permitDocType: string | null;
  missing: boolean;
  generated: boolean;
  permitLock: "submitted" | "issued" | null;
  uploadedBy: { id: string; firstName: string; lastName: string };
};

export type PermitParty = {
  id: string;
  role: string;
  name: string;
  email: string | null;
  phone: string | null;
  licenseNumber: string | null;
  organization: { id: string; name: string; kind: string } | null;
};

export type ManifestEntry = { fileId: string; name: string; docType: string | null; bytes: number; entry: string; sha256: string };

export type PermitCycle = {
  id: string;
  number: number;
  submittedAt: string | null;
  outcome: "PENDING" | "APPROVED" | "CORRECTIONS" | "DENIED" | "WITHDRAWN";
  outcomeAt: string | null;
  reviewerName: string | null;
  notes: string | null;
  submission: {
    id: string;
    kind: string;
    sha256: string;
    sizeBytes: number;
    manifest: ManifestEntry[];
    method: string;
    confirmationRef: string | null;
    notes: string | null;
    submittedAt: string;
    submittedBy: { id: string; firstName: string; lastName: string };
  } | null;
};

export type ChecklistLine = {
  requirement: { id: string; title: string; body: string | null; documentType: string | null; required: boolean; reliability: string; sourceUrl: string | null; jurisdictionId: string | null; permitTypeKey: string | null };
  files: { id: string; fileName: string }[];
  met: boolean;
};

export type HistoryRow = { id: string; action: string; beforeJson: unknown; afterJson: unknown; createdAt: string; actor: { firstName: string; lastName: string } | null };

export type PermitDetail = {
  permit: PermitRecord & {
    job: JobLabelInput & { id: string; leadId: string };
    jurisdiction: { id: string; name: string; kind: string; county: string | null; hvhz: boolean; portalUrl: string | null; submissionMethod: string; reviewDaysTarget: number | null } | null;
    parties: PermitParty[];
    cycles: PermitCycle[];
    inspections: PermitInspection[];
  };
  files: PermitFile[];
  tasks: TaskListItem[];
  history: HistoryRow[];
  steps: InspectionStep[];
  checklist: ChecklistLine[];
  checklistSummary: { required: number; requiredMet: number; optional: number; optionalMet: number };
  permissions: { canEdit: boolean; canSubmit: boolean; canManageSettings: boolean };
};

export const PARTY_ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  APPLICANT: "Applicant",
  QUALIFIER: "Qualifier",
  ARCHITECT: "Architect",
  ENGINEER_OF_RECORD: "Engineer of record",
  SUBCONTRACTOR: "Subcontractor",
  OTHER: "Other",
};

export const OUTCOME_LABEL: Record<PermitCycle["outcome"], string> = {
  PENDING: "Waiting on the department",
  APPROVED: "Approved",
  CORRECTIONS: "Corrections requested",
  DENIED: "Denied",
  WITHDRAWN: "Withdrawn",
};

export const METHOD_LABEL: Record<string, string> = { PORTAL: "Online portal", EMAIL: "Email", IN_PERSON: "In person", MAIL: "Mail", UNKNOWN: "Not recorded" };
