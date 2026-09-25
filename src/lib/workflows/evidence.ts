import type { Prisma, WorkflowEvidenceType, PermitInspectionResult } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * "Can this step be completed?" — the server-side gate behind Complete.
 *
 * Each evidence type points at where the evidence lives in the CRM, so the
 * 400 message tells the user what to go and do rather than "requirement not
 * met". The checklist is checked first because it is the thing they can fix
 * without leaving the sheet.
 *
 * Job evidence reads the task's job; violation evidence reads the task's
 * case (and, for permits, the case's linked corrective job). Every case
 * branch is one `findUnique` on the case.
 */

export type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  doneAt?: string | null;
  doneByUserId?: string | null;
};

export type EvidenceHint =
  | "checklist"
  | "attach_file"
  | "attach_photo"
  | "permit"
  | "permit_status"
  | "inspection"
  | "payment"
  | "note"
  // Violation cases: where on the case page the evidence is recorded.
  | "agency"
  | "hearing"
  | "fine"
  | "items"
  | "job";

export type EvidenceCheck = { ok: true } | { ok: false; message: string; hint: EvidenceHint };

export type EvidenceTask = {
  id: string;
  jobId: string | null;
  violationCaseId?: string | null;
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

const fail = (hint: EvidenceHint, message: string): EvidenceCheck => ({ ok: false, hint, message });
const NEEDS_CASE = fail("agency", "This step needs a code-violation case");

const CASE_EVIDENCE_SELECT = {
  id: true,
  jobId: true,
  agencyConfirmedAt: true,
  fineAccrualStoppedAt: true,
  officialBalanceAsOf: true,
  officialBalance: true,
  amountPaid: true,
  fineResolvedAt: true,
  lienReleasedAt: true,
  correctiveWorkCompletedAt: true,
} satisfies Prisma.CodeViolationCaseSelect;

async function loadCase(id: string) {
  return prisma.codeViolationCase.findUnique({ where: { id }, select: CASE_EVIDENCE_SELECT });
}

export async function checkEvidence(task: EvidenceTask): Promise<EvidenceCheck> {
  const checklist = readChecklist(task.checklist);
  const left = checklist.filter((c) => !c.done).length;
  if (left > 0) {
    return fail("checklist", `Finish the checklist first — ${left} of ${checklist.length} item${checklist.length === 1 ? "" : "s"} still open`);
  }

  const param = (task.requiredEvidenceParam ?? "").toUpperCase();

  switch (task.requiredEvidence) {
    case null:
    case undefined:
      return { ok: true };
    case "ATTACHMENT": {
      const n = await prisma.file.count({ where: { taskId: task.id } });
      return n > 0 ? { ok: true } : fail("attach_file", "Attach the document to this step before completing it");
    }
    case "PHOTO": {
      const n = await prisma.file.count({ where: { taskId: task.id, fileType: { startsWith: "image/" } } });
      return n > 0 ? { ok: true } : fail("attach_photo", "Attach at least one photo to this step before completing it");
    }
    case "PERMIT_NUMBER": {
      // A job step reads its job; a case step reads the case's linked corrective job.
      let jobId = task.jobId;
      if (!jobId && task.violationCaseId) jobId = (await loadCase(task.violationCaseId))?.jobId ?? null;
      if (!jobId) return fail("permit", task.violationCaseId ? "Link the corrective job that holds the permit to this case first" : "This step needs a job with a permit on file");
      const n = await prisma.jobPermit.count({ where: { jobId, permitNumber: { not: null } } });
      return n > 0 ? { ok: true } : fail("permit", "Record the permit number on the job's Permits tab first");
    }
    case "PERMIT_DETERMINATION": {
      if (!task.workflowInstanceId) return { ok: true };
      const inst = await prisma.jobWorkflowInstance.findUnique({
        where: { id: task.workflowInstanceId },
        select: { permitStatus: true },
      });
      return inst && inst.permitStatus !== "UNDETERMINED"
        ? { ok: true }
        : fail("permit_status", "Set the permit status (required or not required) on the Workflow tab first");
    }
    case "INSPECTION_RESULT":
      return task.inspectionResult === "PASS" || task.inspectionResult === "CONDITIONAL"
        ? { ok: true }
        : fail("inspection", "Record a passing (or conditional) inspection result first");
    case "PAYMENT_STATUS": {
      if (!task.jobId) return fail("payment", "This step needs a job with payments");
      const job = await prisma.job.findUnique({
        where: { id: task.jobId },
        select: { depositReceived: true, depositReceivedDate: true, finalPaymentReceived: true },
      });
      if (!job) return fail("payment", "Job not found");
      const depositIn = job.depositReceivedDate !== null || Number(job.depositReceived) > 0;
      const which = param || "ANY";
      const ok = which === "DEPOSIT" ? depositIn : which === "FINAL" ? job.finalPaymentReceived : depositIn || job.finalPaymentReceived;
      if (ok) return { ok: true };
      return fail(
        "payment",
        which === "FINAL" ? "Record the final payment on the job's Invoices tab first" : "Record the deposit on the job's Invoices tab first",
      );
    }
    case "NOTE": {
      const n = await prisma.taskEvent.count({ where: { taskId: task.id, type: "NOTE" } });
      return n > 0 ? { ok: true } : fail("note", "Add a note describing what was done before completing this step");
    }

    // ── Code-violation cases ─────────────────────────────────────────────
    case "AGENCY_CONFIRMATION": {
      if (!task.violationCaseId) return NEEDS_CASE;
      const c = await loadCase(task.violationCaseId);
      if (!c) return fail("agency", "Case not found");
      return c.agencyConfirmedAt ? { ok: true } : fail("agency", "Record the agency's written compliance confirmation on the case first");
    }
    case "HEARING_RESULT": {
      if (!task.violationCaseId) return NEEDS_CASE;
      const h = await prisma.codeViolationHearing.findFirst({
        where: { caseId: task.violationCaseId, status: { not: "CANCELLED" } },
        orderBy: { scheduledAt: "desc" },
        select: { outcome: true },
      });
      return h?.outcome ? { ok: true } : fail("hearing", "Record the hearing outcome on the Hearings tab first");
    }
    case "FINE_STATUS": {
      if (!task.violationCaseId) return NEEDS_CASE;
      const c = await loadCase(task.violationCaseId);
      if (!c) return fail("fine", "Case not found");
      switch (param || "RESOLVED") {
        case "STOPPED":
          return c.fineAccrualStoppedAt ? { ok: true } : fail("fine", "Record the official date fines stopped accruing on Fines & Liens first");
        case "OFFICIAL_BALANCE":
          return c.officialBalanceAsOf ? { ok: true } : fail("fine", "Enter the agency's official balance and its date on Fines & Liens first");
        case "PAID":
          return c.officialBalance !== null && Number(c.amountPaid) >= Number(c.officialBalance)
            ? { ok: true }
            : fail("fine", "Record the payment on Fines & Liens first — the amount paid must cover the official balance");
        case "LIEN_RELEASED":
          return c.lienReleasedAt ? { ok: true } : fail("fine", "Record the lien release on Fines & Liens first");
        default:
          return c.fineResolvedAt ? { ok: true } : fail("fine", "Mark the fines resolved on Fines & Liens first");
      }
    }
    case "VIOLATION_ITEMS": {
      if (!task.violationCaseId) return NEEDS_CASE;
      const items = await prisma.codeViolationItem.findMany({ where: { caseId: task.violationCaseId }, select: { status: true } });
      if (param === "COMPLETE") {
        const open = items.filter((i) => i.status !== "VERIFIED" && i.status !== "WITHDRAWN").length;
        return open === 0 && items.length > 0
          ? { ok: true }
          : fail("items", open > 0 ? `${open} violation item${open === 1 ? " is" : "s are"} not yet verified or withdrawn` : "The case has no violation items");
      }
      return items.length > 0 ? { ok: true } : fail("items", "Create a violation item for every cited violation first");
    }
    case "LINKED_JOB": {
      if (!task.violationCaseId) return NEEDS_CASE;
      const c = await loadCase(task.violationCaseId);
      if (!c) return fail("job", "Case not found");
      if (!c.jobId) return fail("job", "Create or link the corrective construction job on the case first");
      if (param === "WORKFLOW") {
        const inst = await prisma.jobWorkflowInstance.findUnique({ where: { jobId: c.jobId }, select: { id: true } });
        return inst ? { ok: true } : fail("job", "Apply the Core + trade workflow on the linked job first");
      }
      if (param === "COMPLETE") {
        return c.correctiveWorkCompletedAt
          ? { ok: true }
          : fail("job", "The linked job's workflow has not completed — finish it (or close the job) first");
      }
      return { ok: true };
    }
    case "LINKED_JOB_PERMIT": {
      if (!task.violationCaseId) return NEEDS_CASE;
      const c = await loadCase(task.violationCaseId);
      if (!c) return fail("permit", "Case not found");
      if (!c.jobId) return fail("permit", "Link the corrective job that holds the permit to this case first");
      const where: Prisma.JobPermitWhereInput =
        param === "ISSUED"
          ? { jobId: c.jobId, status: { in: ["ISSUED", "IN_PROGRESS", "FINAL"] } }
          : param === "FINAL"
            ? { jobId: c.jobId, status: "FINAL" }
            : { jobId: c.jobId, permitNumber: { not: null } };
      const n = await prisma.jobPermit.count({ where });
      if (n > 0) return { ok: true };
      return fail(
        "permit",
        param === "ISSUED"
          ? "Mark the permit issued on the linked job's Permits tab first"
          : param === "FINAL"
            ? "Mark the permit finaled on the linked job's Permits tab first"
            : "Record the permit number on the linked job's Permits tab first",
      );
    }
  }
}
