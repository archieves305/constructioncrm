import type { Prisma } from "@/generated/prisma/client";
import { JOB_LABEL_SELECT, LEAD_LABEL_SELECT } from "@/lib/labels/select";

/**
 * The one shape every task reader and writer returns.
 *
 * Lifted out of the route handlers so `createTask`, `updateTask`, the list
 * and detail routes and the entity panels all agree on which relations are
 * loaded — a panel that renders `task.invoice.invoiceNumber` must never be
 * fed a row that was created through a path that forgot to include it.
 */
/** The label fields plus the number to call from the task sheet. */
const LEAD_WITH_PHONE = { ...LEAD_LABEL_SELECT, primaryPhone: true } satisfies Prisma.LeadSelect;

export const TASK_LIST_INCLUDE = {
  lead: { select: LEAD_WITH_PHONE },
  job: { select: { ...JOB_LABEL_SELECT, lead: { select: LEAD_WITH_PHONE } } },
  estimate: { select: { id: true, estimateNumber: true, name: true, leadId: true } },
  invoice: { select: { id: true, invoiceNumber: true, jobId: true } },
  prospect: { select: { id: true, propertyAddress1: true, city: true } },
  dailyLog: { select: { id: true, jobId: true, logDate: true } },
  vendor: { select: { id: true, name: true } },
  violationCase: { select: { id: true, caseNumber: true, agencyCaseNumber: true, leadId: true } },
  violationItem: { select: { id: true, itemNumber: true, caseId: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { events: { where: { type: "NOTE" } }, files: true } },
} satisfies Prisma.TaskInclude;

export const TASK_DETAIL_INCLUDE = {
  ...TASK_LIST_INCLUDE,
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  // Workflow: what this step waits on, and files attached as evidence.
  dependencies: {
    select: {
      kind: true,
      source: true,
      dependsOnTaskId: true,
      dependsOn: { select: { id: true, title: true, status: true, workflowTaskKey: true, activatedAt: true } },
    },
  },
  files: {
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, fileType: true, fileSize: true, category: true, createdAt: true, uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
  },
  fieldIssue: { select: { id: true, status: true } },
  watchers: {
    select: {
      id: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  events: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      body: true,
      fromValue: true,
      toValue: true,
      editedAt: true,
      createdAt: true,
      actor: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.TaskInclude;

export type TaskListRow = Prisma.TaskGetPayload<{ include: typeof TASK_LIST_INCLUDE }>;
export type TaskDetailRow = Prisma.TaskGetPayload<{ include: typeof TASK_DETAIL_INCLUDE }>;
