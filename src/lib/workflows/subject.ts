import type { Prisma, WorkflowPermitStatus, WorkflowTemplateKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ScheduleContext } from "./schedule";

/**
 * The "subject" a workflow runs on: a Job or a CodeViolationCase.
 *
 * Everything the engine ever needed from a job — who its PM is, when it was
 * created, its target start, where to link the tasks it makes — is read
 * through this one shape, so `apply`, `reconcile`, activation, roles,
 * evidence and the read model do not know which kind of record owns the
 * instance. A job composes Core + trades; a violation case composes exactly
 * one VIOLATION template and never Core.
 */

export type WorkflowSubjectKind = "job" | "violation";

export type WorkflowSubjectRef =
  | { kind: "job"; jobId: string }
  | { kind: "violation"; violationCaseId: string };

export type WorkflowSubjectInstance = {
  id: string;
  permitStatus: WorkflowPermitStatus;
  scopeToggles: Prisma.JsonValue;
  appliedAt: Date;
  modules: { templateKey: string }[];
};

export type WorkflowSubject = {
  kind: WorkflowSubjectKind;
  id: string;
  /** Property + customer record; every workflow task carries it. */
  leadId: string;
  /** "JOB-00012" / "CV-00003", for logs, audit and messages. */
  label: string;
  createdAt: Date;
  jurisdiction: string | null;
  dates: {
    targetStartDate: Date | null;
    complianceDeadline: Date | null;
    hearingDate: Date | null;
  };
  people: {
    projectManagerId: string | null;
    salesRepId: string | null;
    caseManagerId: string | null;
  };
  instance: WorkflowSubjectInstance | null;
};

/** What `createTask` gets from the subject. A case's tasks never carry `jobId`. */
export type TaskLinks = { leadId: string; jobId?: string | null; violationCaseId?: string | null };

type Db = Prisma.TransactionClient | typeof prisma;

const INSTANCE_SELECT = {
  id: true,
  permitStatus: true,
  scopeToggles: true,
  appliedAt: true,
  modules: { where: { removedAt: null }, select: { templateKey: true } },
} satisfies Prisma.JobWorkflowInstanceSelect;

const JOB_SELECT = {
  id: true,
  leadId: true,
  jobNumber: true,
  createdAt: true,
  targetStartDate: true,
  jurisdiction: true,
  projectManagerId: true,
  salesRepId: true,
} satisfies Prisma.JobSelect;

const CASE_SELECT = {
  id: true,
  leadId: true,
  caseNumber: true,
  createdAt: true,
  jurisdiction: true,
  originalDeadline: true,
  currentDeadline: true,
  nextHearingAt: true,
  caseManagerId: true,
  job: { select: { projectManagerId: true, salesRepId: true } },
} satisfies Prisma.CodeViolationCaseSelect;

type JobRow = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;
type CaseRow = Prisma.CodeViolationCaseGetPayload<{ select: typeof CASE_SELECT }>;

export function refOf(subject: Pick<WorkflowSubject, "kind" | "id">): WorkflowSubjectRef {
  return subject.kind === "job" ? { kind: "job", jobId: subject.id } : { kind: "violation", violationCaseId: subject.id };
}

/** Core Construction is composed onto every job; a case runs one VIOLATION template alone. */
export function requiresCore(kind: WorkflowSubjectKind): boolean {
  return kind === "job";
}

/** Which template kinds a subject may apply. */
export function allowedTemplateKinds(kind: WorkflowSubjectKind): readonly WorkflowTemplateKind[] {
  return kind === "job" ? ["CORE", "TRADE"] : ["VIOLATION"];
}

export function instanceWhere(ref: WorkflowSubjectRef): Prisma.JobWorkflowInstanceWhereUniqueInput {
  return ref.kind === "job" ? { jobId: ref.jobId } : { violationCaseId: ref.violationCaseId };
}

export function instanceCreateLink(ref: WorkflowSubjectRef): { jobId: string } | { violationCaseId: string } {
  return ref.kind === "job" ? { jobId: ref.jobId } : { violationCaseId: ref.violationCaseId };
}

export function taskLinksFor(subject: Pick<WorkflowSubject, "kind" | "id" | "leadId">): TaskLinks {
  return subject.kind === "job"
    ? { leadId: subject.leadId, jobId: subject.id }
    : { leadId: subject.leadId, violationCaseId: subject.id };
}

/** Where-fragment for "tasks on this subject" (manual ones included). */
export function taskLinkWhere(subject: Pick<WorkflowSubject, "kind" | "id">): Prisma.TaskWhereInput {
  return subject.kind === "job" ? { jobId: subject.id } : { violationCaseId: subject.id };
}

export function scheduleContextFor(
  subject: Pick<WorkflowSubject, "createdAt" | "dates">,
  appliedAt: Date,
  override?: { targetStartDate?: Date | null },
): ScheduleContext {
  return {
    subjectCreatedAt: subject.createdAt,
    appliedAt,
    targetStartDate: override?.targetStartDate === undefined ? subject.dates.targetStartDate : override.targetStartDate,
    complianceDeadline: subject.dates.complianceDeadline,
    hearingDate: subject.dates.hearingDate,
  };
}

function fromJob(job: JobRow, instance: WorkflowSubjectInstance | null): WorkflowSubject {
  return {
    kind: "job",
    id: job.id,
    leadId: job.leadId,
    label: job.jobNumber,
    createdAt: job.createdAt,
    jurisdiction: job.jurisdiction,
    dates: { targetStartDate: job.targetStartDate, complianceDeadline: null, hearingDate: null },
    people: { projectManagerId: job.projectManagerId, salesRepId: job.salesRepId, caseManagerId: null },
    instance,
  };
}

function fromCase(c: CaseRow, instance: WorkflowSubjectInstance | null): WorkflowSubject {
  return {
    kind: "violation",
    id: c.id,
    leadId: c.leadId,
    label: c.caseNumber,
    createdAt: c.createdAt,
    jurisdiction: c.jurisdiction,
    dates: {
      targetStartDate: null,
      complianceDeadline: c.currentDeadline ?? c.originalDeadline,
      hearingDate: c.nextHearingAt,
    },
    // A case's PROJECT_MANAGER steps resolve to the linked corrective job's PM.
    people: { projectManagerId: c.job?.projectManagerId ?? null, salesRepId: c.job?.salesRepId ?? null, caseManagerId: c.caseManagerId },
    instance,
  };
}

export async function loadSubject(db: Db, ref: WorkflowSubjectRef): Promise<WorkflowSubject | null> {
  if (ref.kind === "job") {
    const job = await db.job.findUnique({ where: { id: ref.jobId }, select: { ...JOB_SELECT, workflow: { select: INSTANCE_SELECT } } });
    if (!job) return null;
    const { workflow, ...row } = job;
    return fromJob(row, workflow);
  }
  const c = await db.codeViolationCase.findUnique({ where: { id: ref.violationCaseId }, select: { ...CASE_SELECT, workflow: { select: INSTANCE_SELECT } } });
  if (!c) return null;
  const { workflow, ...row } = c;
  return fromCase(row, workflow);
}

/** The subject that owns an instance — what reconcile, activation, roles and inspections start from. */
export async function loadSubjectForInstance(db: Db, instanceId: string): Promise<WorkflowSubject | null> {
  const inst = await db.jobWorkflowInstance.findUnique({
    where: { id: instanceId },
    select: { ...INSTANCE_SELECT, jobId: true, violationCaseId: true, job: { select: JOB_SELECT }, violationCase: { select: CASE_SELECT } },
  });
  if (!inst) return null;
  const instance: WorkflowSubjectInstance = { id: inst.id, permitStatus: inst.permitStatus, scopeToggles: inst.scopeToggles, appliedAt: inst.appliedAt, modules: inst.modules };
  if (inst.job) return fromJob(inst.job, instance);
  if (inst.violationCase) return fromCase(inst.violationCase, instance);
  return null;
}

/** Fields the Apply / permit dialogs may write onto the subject itself. */
export async function writeSubjectFields(
  tx: Db,
  subject: Pick<WorkflowSubject, "kind" | "id">,
  input: { targetStartDate?: Date | null; jurisdiction?: string | null },
): Promise<void> {
  if (input.targetStartDate === undefined && input.jurisdiction === undefined) return;
  if (subject.kind === "job") {
    await tx.job.update({
      where: { id: subject.id },
      data: {
        ...(input.targetStartDate !== undefined ? { targetStartDate: input.targetStartDate } : {}),
        ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction } : {}),
      },
    });
    return;
  }
  if (input.jurisdiction !== undefined) {
    await tx.codeViolationCase.update({ where: { id: subject.id }, data: { jurisdiction: input.jurisdiction } });
  }
}
