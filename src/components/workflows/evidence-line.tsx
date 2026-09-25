"use client";

import Link from "next/link";
import { BadgeCheck, Briefcase, Camera, ClipboardCheck, DollarSign, FileText, Gavel, Landmark, ListChecks, MessageSquare, Paperclip, Wallet } from "lucide-react";
import type { WorkflowEvidenceType } from "@/generated/prisma/client";
import { subjectHref, type WorkflowSubjectRef, type WorkflowTaskItem } from "./types";

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

/** Where a hint's evidence lives on the subject's page, for the "go here" link. */
export function evidenceHref(subject: WorkflowSubjectRef, hint: string): { href: string; label: string } | null {
  const base = subjectHref(subject);
  if (subject.kind === "job") {
    switch (hint) {
      case "permit":
        return { href: `${base}?tab=permits`, label: "Permits tab" };
      case "payment":
        return { href: `${base}?tab=money&sub=payments`, label: "Payments" };
      default:
        return null;
    }
  }
  switch (hint) {
    case "permit":
      return { href: `${base}?tab=permits`, label: "Permits tab" };
    case "agency":
      return { href: `${base}?tab=inspections`, label: "Inspections tab" };
    case "hearing":
      return { href: `${base}?tab=hearings`, label: "Hearings tab" };
    case "fine":
      return { href: `${base}?tab=fines`, label: "Fines & Liens" };
    case "items":
      return { href: `${base}?tab=items`, label: "Items tab" };
    case "job":
      return { href: `${base}?tab=overview`, label: "Overview" };
    default:
      return null;
  }
}

const HINT_FOR: Partial<Record<WorkflowEvidenceType, string>> = {
  PERMIT_NUMBER: "permit",
  PAYMENT_STATUS: "payment",
  AGENCY_CONFIRMATION: "agency",
  HEARING_RESULT: "hearing",
  FINE_STATUS: "fine",
  VIOLATION_ITEMS: "items",
  LINKED_JOB: "job",
  LINKED_JOB_PERMIT: "permit",
};

/** "Needs X — go here" for a step's required evidence. */
export function EvidenceLine({ task, subject, onOpenTask, compact }: { task: WorkflowTaskItem; subject: WorkflowSubjectRef; onOpenTask?: () => void; compact?: boolean }) {
  const ev = task.requiredEvidence;
  if (!ev) return null;
  const Icon = ICON[ev];
  const files = task._count?.files ?? 0;
  const satisfied =
    (ev === "ATTACHMENT" || ev === "PHOTO") ? files > 0
    : ev === "INSPECTION_RESULT" ? task.inspectionResult === "PASS" || task.inspectionResult === "CONDITIONAL"
    : null;
  const label =
    ev === "PAYMENT_STATUS" && task.requiredEvidenceParam ? `Needs the ${task.requiredEvidenceParam.toLowerCase()} payment recorded`
    : ev === "FINE_STATUS" && task.requiredEvidenceParam ? `Needs the fine status "${task.requiredEvidenceParam.toLowerCase().replace(/_/g, " ")}" recorded on Fines & Liens`
    : ev === "LINKED_JOB" && task.requiredEvidenceParam === "COMPLETE" ? "Needs the linked job's work complete"
    : ev === "LINKED_JOB" && task.requiredEvidenceParam === "WORKFLOW" ? "Needs the linked job's workflow applied"
    : ev === "LINKED_JOB_PERMIT" && task.requiredEvidenceParam ? `Needs the linked job's permit ${task.requiredEvidenceParam.toLowerCase()}`
    : ev === "VIOLATION_ITEMS" && task.requiredEvidenceParam === "COMPLETE" ? "Needs every violation item verified or withdrawn"
    : LABEL[ev];
  const hint = HINT_FOR[ev];
  const link = hint ? evidenceHref(subject, hint) : null;
  const where =
    ev === "ATTACHMENT" || ev === "PHOTO" ? (
      onOpenTask ? <button type="button" className="underline" onClick={onOpenTask}>{files > 0 ? `${files} attached` : "attach"}</button> : null
    ) : link ? (
      <Link href={link.href} className="underline">{link.label}</Link>
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
