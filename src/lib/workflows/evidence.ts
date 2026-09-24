import type { Prisma, WorkflowEvidenceType, PermitInspectionResult } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * "Can this step be completed?" — the server-side gate behind Complete.
 *
 * Each evidence type points at where the evidence lives in the CRM, so the
 * 400 message tells the user what to go and do rather than "requirement not
 * met". The checklist is checked first because it is the thing they can fix
 * without leaving the sheet.
 */

export type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  doneAt?: string | null;
  doneByUserId?: string | null;
};

export type EvidenceHint = "checklist" | "attach_file" | "attach_photo" | "permit" | "permit_status" | "inspection" | "payment" | "note";

export type EvidenceCheck = { ok: true } | { ok: false; message: string; hint: EvidenceHint };

export type EvidenceTask = {
  id: string;
  jobId: string | null;
  workflowInstanceId: string | null;
  requiredEvidence: WorkflowEvidenceType | null;
  requiredEvidenceParam: string | null;
  checklist: Prisma.JsonValue | null;
  inspectionResult: PermitInspectionResult | null;
};

export function readChecklist(raw: Prisma.JsonValue | null | undefined): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const o = item as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") return [];
    return [
      {
        key: o.key,
        label: o.label,
        done: o.done === true,
        doneAt: typeof o.doneAt === "string" ? o.doneAt : null,
        doneByUserId: typeof o.doneByUserId === "string" ? o.doneByUserId : null,
      },
    ];
  });
}

/** Apply `{key, done}` ticks to a checklist; unknown keys are ignored. */
export function mergeChecklist(
  current: ChecklistItem[],
  ticks: { key: string; done: boolean }[],
  actor: { userId: string; now: Date },
): { items: ChecklistItem[]; changed: boolean } {
  let changed = false;
  const byKey = new Map(ticks.map((t) => [t.key, t.done]));
  const items = current.map((item) => {
    const next = byKey.get(item.key);
    if (next === undefined || next === item.done) return item;
    changed = true;
    return next
      ? { ...item, done: true, doneAt: actor.now.toISOString(), doneByUserId: actor.userId }
      : { ...item, done: false, doneAt: null, doneByUserId: null };
  });
  return { items, changed };
}

export async function checkEvidence(task: EvidenceTask): Promise<EvidenceCheck> {
  const checklist = readChecklist(task.checklist);
  const left = checklist.filter((c) => !c.done).length;
  if (left > 0) {
    return {
      ok: false,
      hint: "checklist",
      message: `Finish the checklist first — ${left} of ${checklist.length} item${checklist.length === 1 ? "" : "s"} still open`,
    };
  }

  switch (task.requiredEvidence) {
    case null:
    case undefined:
      return { ok: true };
    case "ATTACHMENT": {
      const n = await prisma.file.count({ where: { taskId: task.id } });
      return n > 0 ? { ok: true } : { ok: false, hint: "attach_file", message: "Attach the document to this step before completing it" };
    }
    case "PHOTO": {
      const n = await prisma.file.count({ where: { taskId: task.id, fileType: { startsWith: "image/" } } });
      return n > 0 ? { ok: true } : { ok: false, hint: "attach_photo", message: "Attach at least one photo to this step before completing it" };
    }
    case "PERMIT_NUMBER": {
      if (!task.jobId) return { ok: false, hint: "permit", message: "This step needs a job with a permit on file" };
      const n = await prisma.jobPermit.count({ where: { jobId: task.jobId, permitNumber: { not: null } } });
      return n > 0 ? { ok: true } : { ok: false, hint: "permit", message: "Record the permit number on the job's Permits tab first" };
    }
    case "PERMIT_DETERMINATION": {
      if (!task.workflowInstanceId) return { ok: true };
      const inst = await prisma.jobWorkflowInstance.findUnique({
        where: { id: task.workflowInstanceId },
        select: { permitStatus: true },
      });
      return inst && inst.permitStatus !== "UNDETERMINED"
        ? { ok: true }
        : { ok: false, hint: "permit_status", message: "Set the permit status (required or not required) on the Workflow tab first" };
    }
    case "INSPECTION_RESULT":
      return task.inspectionResult === "PASS" || task.inspectionResult === "CONDITIONAL"
        ? { ok: true }
        : { ok: false, hint: "inspection", message: "Record a passing (or conditional) inspection result first" };
    case "PAYMENT_STATUS": {
      if (!task.jobId) return { ok: false, hint: "payment", message: "This step needs a job with payments" };
      const job = await prisma.job.findUnique({
        where: { id: task.jobId },
        select: { depositReceived: true, depositReceivedDate: true, finalPaymentReceived: true },
      });
      if (!job) return { ok: false, hint: "payment", message: "Job not found" };
      const depositIn = job.depositReceivedDate !== null || Number(job.depositReceived) > 0;
      const which = (task.requiredEvidenceParam ?? "ANY").toUpperCase();
      const ok = which === "DEPOSIT" ? depositIn : which === "FINAL" ? job.finalPaymentReceived : depositIn || job.finalPaymentReceived;
      if (ok) return { ok: true };
      return {
        ok: false,
        hint: "payment",
        message:
          which === "FINAL"
            ? "Record the final payment on the job's Invoices tab first"
            : "Record the deposit on the job's Invoices tab first",
      };
    }
    case "NOTE": {
      const n = await prisma.taskEvent.count({ where: { taskId: task.id, type: "NOTE" } });
      return n > 0 ? { ok: true } : { ok: false, hint: "note", message: "Add a note describing what was done before completing this step" };
    }
  }
}
