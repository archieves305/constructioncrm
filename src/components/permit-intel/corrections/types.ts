import type { CorrectionCategory, CorrectionStatus, CorrectionTarget, ResponsibleParty } from "@/lib/permit-intel/corrections-plan";

/** `GET /api/permits/[id]/corrections` as the Corrections tab reads it. */
export type CorrectionItem = {
  id: string;
  noticeId: string;
  sortOrder: number;
  reviewerItemNumber: string | null;
  reviewerDiscipline: string | null;
  text: string;
  sourcePage: number | null;
  category: CorrectionCategory;
  affects: CorrectionTarget;
  affectsRef: string | null;
  responsibleParty: ResponsibleParty;
  partyId: string | null;
  confidence: number | null;
  fromAi: boolean;
  status: CorrectionStatus;
  response: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  previousItemId: string | null;
  reviewOutcome: "ACCEPTED" | "RECOMMENTED" | null;
  party: { id: string; name: string; role: string; email: string | null } | null;
  task: { id: string; status: string; assignedUserId: string | null; dueAt: string | null } | null;
  files: { file: { id: string; fileName: string; permitDocType: string | null } }[];
  previousItem: { id: string; reviewerItemNumber: string | null; sortOrder: number } | null;
};

export type CorrectionNotice = {
  id: string;
  permitId: string;
  source: "UPLOAD" | "PASTE";
  receivedAt: string;
  rawText: string | null;
  reviewerName: string | null;
  responseDueAt: string | null;
  status: "EXTRACTING" | "REVIEW" | "CONFIRMED" | "FAILED";
  summary: string | null;
  error: string | null;
  confirmedAt: string | null;
  cycle: { id: string; number: number; outcome: string };
  file: { id: string; fileName: string; fileType: string; fileSize: number } | null;
  createdBy: { id: string; firstName: string; lastName: string };
  confirmedBy: { id: string; firstName: string; lastName: string } | null;
  aiCall: { id: string; model: string; costUsd: number } | null;
  items: CorrectionItem[];
};

export type PermitMessage = {
  id: string;
  partyId: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  body: string;
  purpose: string;
  correctionItemIds: string[];
  attachmentFileIds: string[];
  status: "DRAFT" | "SENT" | "DISCARDED";
  aiCallId: string | null;
  sentAt: string | null;
  createdAt: string;
  party: { id: string; name: string; role: string } | null;
  createdBy: { firstName: string; lastName: string };
  sentBy: { firstName: string; lastName: string } | null;
};

export type CorrectionsData = {
  notices: CorrectionNotice[];
  messages: PermitMessage[];
  permissions: { canEdit: boolean; canConfirm: boolean; canSend: boolean; aiReady: boolean };
};
