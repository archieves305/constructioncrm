import { prisma } from "@/lib/db/prisma";
import type { CaseScope } from "./access";

/** Who is on a case, for the permission checks. Null when the case does not exist. */
export async function caseScopeFor(caseId: string): Promise<CaseScope | null> {
  const c = await prisma.codeViolationCase.findUnique({
    where: { id: caseId },
    select: {
      caseManagerId: true,
      items: { select: { assignedUserId: true } },
      tasks: { where: { assignedUserId: { not: null } }, select: { assignedUserId: true } },
      workflow: { select: { team: { select: { userId: true } } } },
    },
  });
  if (!c) return null;
  return {
    caseManagerId: c.caseManagerId,
    itemAssigneeIds: Array.from(new Set(c.items.flatMap((i) => (i.assignedUserId ? [i.assignedUserId] : [])))),
    taskAssigneeIds: Array.from(new Set(c.tasks.flatMap((t) => (t.assignedUserId ? [t.assignedUserId] : [])))),
    teamUserIds: c.workflow?.team.map((t) => t.userId) ?? [],
  };
}
