"use client";

import Link from "next/link";
import { BadgeCheck, Briefcase, Camera, ClipboardCheck, DollarSign, FileText, Gavel, Landmark, ListChecks, MessageSquare, Paperclip, Wallet } from "lucide-react";
import type { WorkflowEvidenceType } from "@/generated/prisma/client";
import type { WorkflowTaskItem } from "./types";

const LABEL: Record<WorkflowEvidenceType, string> = {
  ATTACHMENT: "Needs an attached document",
  PHOTO: "Needs at least one photo",
  PERMIT_NUMBER: "Needs the permit number on the job",
  PERMIT_DETERMINATION: "Needs the permit status decided",
  INSPECTION_RESULT: "Needs a passing inspection result",
  PAYMENT_STATUS: "Needs the payment recorded",
  NOTE: "Needs a note saying what was done",
  AGENCY_CONFIRMATION: "Needs the agency's compliance confirmation on the case",
  HEARING_RESULT: "Needs the hearing outcome recorded",
  FINE_STATUS: "Needs the fine status recorded on Fines & Liens",
  VIOLATION_ITEMS: "Needs the violation items on the case",
  LINKED_JOB: "Needs the corrective job linked to the case",
  LINKED_JOB_PERMIT: "Needs the permit on the linked job",
};

const ICON: Record<WorkflowEvidenceType, typeof Paperclip> = {
  ATTACHMENT: Paperclip,
  PHOTO: Camera,
  PERMIT_NUMBER: FileText,
  PERMIT_DETERMINATION: Landmark,
  INSPECTION_RESULT: ClipboardCheck,
  PAYMENT_STATUS: Wallet,
  NOTE: MessageSquare,
  AGENCY_CONFIRMATION: BadgeCheck,
  HEARING_RESULT: Gavel,
  FINE_STATUS: DollarSign,
  VIOLATION_ITEMS: ListChecks,
  LINKED_JOB: Briefcase,
  LINKED_JOB_PERMIT: FileText,
};

/** "Needs X — go here" for a step's required evidence. */
export function EvidenceLine({ task, jobId, onOpenTask, compact }: { task: WorkflowTaskItem; jobId: string; onOpenTask?: () => void; compact?: boolean }) {
  const ev = task.requiredEvidence;
  if (!ev) return null;
  const Icon = ICON[ev];
  const files = task._count?.files ?? 0;
  const satisfied =
    (ev === "ATTACHMENT" || ev === "PHOTO") ? files > 0
    : ev === "INSPECTION_RESULT" ? task.inspectionResult === "PASS" || task.inspectionResult === "CONDITIONAL"
    : null;
  const label = ev === "PAYMENT_STATUS" && task.requiredEvidenceParam ? `Needs the ${task.requiredEvidenceParam.toLowerCase()} payment recorded` : LABEL[ev];
  const where =
    ev === "ATTACHMENT" || ev === "PHOTO" ? (
      onOpenTask ? <button type="button" className="underline" onClick={onOpenTask}>{files > 0 ? `${files} attached` : "attach"}</button> : null
    ) : ev === "PERMIT_NUMBER" ? (
      <Link href={`/jobs/${jobId}?tab=permits`} className="underline">Permits tab</Link>
    ) : ev === "PAYMENT_STATUS" ? (
      <Link href={`/jobs/${jobId}?tab=money&sub=payments`} className="underline">Payments</Link>
    ) : ev === "PERMIT_DETERMINATION" ? (
      <span>Workflow tab</span>
    ) : null;
  return (
    <p className={`flex items-center gap-1.5 text-muted-foreground ${compact ? "text-[11px]" : "text-xs"}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className={satisfied ? "line-through" : ""}>{label}</span>
      {satisfied === true && <span className="text-tone-success-fg">✓</span>}
      {where && <span>· {where}</span>}
    </p>
  );
}
