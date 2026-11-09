import type { Prisma } from "@/generated/prisma/client";
import type { JobSortKey, LeadSortKey, SortState, TaskSortKey } from "./sort";

/**
 * Server side of list sorting: each allowed key → a Prisma orderBy, with the id
 * as the last tie-break so pages never repeat or skip a row. Only keys from
 * lib/lists/sort.ts reach here (parseSort refuses anything else).
 */
const nullsLast = (dir: Prisma.SortOrder) => ({ sort: dir, nulls: "last" as const });

export function jobOrderBy({ key, dir }: SortState<JobSortKey>): Prisma.JobOrderByWithRelationInput[] {
  const by: Record<JobSortKey, Prisma.JobOrderByWithRelationInput> = {
    created: { createdAt: dir },
    property: { lead: { propertyAddress1: dir } },
    customer: { lead: { lastName: dir } },
    service: { serviceType: dir },
    stage: { currentStage: { stageOrder: dir } },
    contract: { contractAmount: dir },
    balance: { balanceDue: dir },
    nextAction: { nextAction: nullsLast(dir) },
    rep: { salesRep: { lastName: dir } },
  };
  return [by[key], { id: "asc" }];
}

export function leadOrderBy({ key, dir }: SortState<LeadSortKey>): Prisma.LeadOrderByWithRelationInput[] {
  const by: Record<LeadSortKey, Prisma.LeadOrderByWithRelationInput> = {
    created: { createdAt: dir },
    name: { lastName: dir },
    address: { propertyAddress1: dir },
    stage: { currentStage: { stageOrder: dir } },
    source: { source: { name: dir } },
    assignee: { assignedUser: { lastName: dir } },
    value: { estimatedJobValue: nullsLast(dir) },
    followUp: { nextFollowUpAt: nullsLast(dir) },
  };
  return [by[key], { id: "asc" }];
}

export function taskOrderBy({ key, dir }: SortState<TaskSortKey>): Prisma.TaskOrderByWithRelationInput[] {
  const by: Record<TaskSortKey, Prisma.TaskOrderByWithRelationInput[]> = {
    due: [{ dueAt: nullsLast(dir) }, { priority: "desc" }],
    priority: [{ priority: dir }, { dueAt: nullsLast("asc") }],
    title: [{ title: dir }],
    created: [{ createdAt: dir }],
    assignee: [{ assignedTo: { lastName: dir } }, { dueAt: nullsLast("asc") }],
  };
  return [...by[key], { id: "asc" }];
}
