import type { Prisma } from "@/generated/prisma/client";

/** The notification-center tabs, as `where` fragments. Pure. */
export type NotificationFilter = "all" | "action" | "mentions" | "tasks" | "jobs";

export const NOTIFICATION_FILTERS: readonly NotificationFilter[] = ["all", "action", "mentions", "tasks", "jobs"];

export function parseNotificationFilter(raw: string | null | undefined): NotificationFilter {
  return raw && (NOTIFICATION_FILTERS as readonly string[]).includes(raw) ? (raw as NotificationFilter) : "all";
}

export function filterWhere(filter: NotificationFilter): Prisma.NotificationWhereInput {
  switch (filter) {
    case "action":
      return { actionRequired: true, readAt: null };
    case "mentions":
      return { kind: { in: ["task.mentioned", "task.nudged"] } };
    case "tasks":
      return { taskId: { not: null } };
    case "jobs":
      return { OR: [{ jobId: { not: null } }, { violationCaseId: { not: null } }] };
    default:
      return {};
  }
}
