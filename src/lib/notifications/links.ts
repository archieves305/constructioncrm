import type { RoleName } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Notification rows store an office path (no host, role-neutral). The link a
 * given person gets is resolved here: CREW_LEADs live in `/field`, so an
 * office task drawer link would bounce them off the shell.
 */
export function hrefForRole(href: string, role: RoleName): string {
  if (role !== "CREW_LEAD") return href;
  const task = href.match(/^\/tasks\?task=([^&]+)/);
  if (task) return `/field/tasks/${task[1]}`;
  const job = href.match(/^\/jobs\/([^/?]+)/);
  if (job) return `/field/jobs/${job[1]}`;
  return href;
}

export function absoluteUrl(path: string): string {
  return `${env.APP_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function urlForRole(href: string, role: RoleName): string {
  return absoluteUrl(hrefForRole(href, role));
}

/** Office paths the producers use, in one place. */
export const paths = {
  task: (taskId: string) => `/tasks?task=${taskId}`,
  job: (jobId: string, tab?: string, sub?: string) => `/jobs/${jobId}${tab ? `?tab=${tab}${sub ? `&sub=${sub}` : ""}` : ""}`,
  lead: (leadId: string, tab?: string) => `/leads/${leadId}${tab ? `?tab=${tab}` : ""}`,
  violationCase: (caseId: string, tab?: string) => `/violations/${caseId}${tab ? `?tab=${tab}` : ""}`,
  notifications: (since?: Date) => `/notifications${since ? `?since=${encodeURIComponent(since.toISOString())}` : ""}`,
};
