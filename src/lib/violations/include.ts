import type { Prisma } from "@/generated/prisma/client";

/** The one shape the list, the mini lists on Lead/Job and the dashboard read. */
export const CASE_LIST_INCLUDE = {
  lead: { select: { id: true, fullName: true, propertyAddress1: true, city: true, state: true, zipCode: true } },
  job: { select: { id: true, jobNumber: true, title: true } },
  caseManager: { select: { id: true, firstName: true, lastName: true } },
  items: { orderBy: { itemNumber: "asc" }, select: { id: true, itemNumber: true, status: true, category: { select: { id: true, key: true, name: true } } } },
  workflow: { select: { id: true, status: true, permitStatus: true } },
  _count: { select: { hearings: true, inspections: true, tasks: true } },
} satisfies Prisma.CodeViolationCaseInclude;

export type CaseListRow = Prisma.CodeViolationCaseGetPayload<{ include: typeof CASE_LIST_INCLUDE }>;

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

export const CASE_DETAIL_INCLUDE = {
  lead: {
    select: {
      id: true, fullName: true, companyName: true, primaryPhone: true, secondaryPhone: true, email: true,
      propertyAddress1: true, propertyAddress2: true, city: true, county: true, state: true, zipCode: true, propertyType: true,
    },
  },
  job: {
    select: {
      id: true, jobNumber: true, title: true, projectManagerId: true, targetStartDate: true, completionDate: true,
      currentStage: { select: { id: true, name: true, isClosed: true } },
      workflow: { select: { id: true, status: true } },
      permits: { orderBy: { createdAt: "desc" }, select: { id: true, municipality: true, permitType: true, permitNumber: true, status: true, submittedDate: true, approvedDate: true, expirationDate: true, finalPassedDate: true, inspectorName: true } },
    },
  },
  caseManager: PERSON,
  createdBy: PERSON,
  closedBy: PERSON,
  items: {
    orderBy: { itemNumber: "asc" },
    include: { category: { select: { id: true, key: true, name: true } }, assignedTo: PERSON, _count: { select: { tasks: true, files: true } } },
  },
  hearings: { orderBy: { scheduledAt: "desc" }, include: { attendee: PERSON } },
  inspections: { orderBy: { requestedAt: "desc" }, include: { attendee: PERSON } },
  extensions: { orderBy: { requestedAt: "desc" } },
  fineEntries: { orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] },
  workflow: { select: { id: true, status: true, permitStatus: true, appliedAt: true, team: { select: { role: true, user: PERSON } } } },
  _count: { select: { tasks: true, files: true, events: true, communications: true } },
} satisfies Prisma.CodeViolationCaseInclude;

export type CaseDetailRow = Prisma.CodeViolationCaseGetPayload<{ include: typeof CASE_DETAIL_INCLUDE }>;
