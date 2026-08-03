import { env } from "@/lib/env";
import type { RoleName } from "@/generated/prisma/client";

/**
 * Where a task email's CTA should send someone.
 *
 * CREW_LEADs are confined to `/field` — the office shell redirects them away —
 * so an office link is a dead end for exactly the people most likely to be
 * reading the mail on a phone at a jobsite. Route by the RECIPIENT's role, not
 * the actor's: the same completion email goes to an office assignor and a crew
 * assignee at once, and each needs a different destination.
 *
 * Office users get a query param rather than a dedicated route because the
 * office task view is a drawer over the list — `?task=` opens it with the list
 * still behind, which is where they want to be next anyway.
 */
export function taskUrlForRole(taskId: string, role: RoleName): string {
  return role === "CREW_LEAD"
    ? `${env.APP_BASE_URL}/field/tasks/${taskId}`
    : `${env.APP_BASE_URL}/tasks?task=${taskId}`;
}

/** The office link, for contexts with no specific recipient (audit rows, logs). */
export function officeTaskUrl(taskId: string): string {
  return `${env.APP_BASE_URL}/tasks?task=${taskId}`;
}
