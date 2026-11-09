/**
 * Phone push notifications for the KNU Field app (CAREYOS_MOBILE_APP_PLAN.md
 * §D.4). Pure rules; sending is push-send.ts.
 *
 * Push is its own channel beside email and the digest: a notification row
 * that is created for someone with a signed-in phone may also buzz it. What
 * it says follows Richard's ruling (2026-11-08): what happened and the job
 * address, never money, customer names or phone numbers. The app fetches the
 * rest after it is opened.
 */

/** The events worth a buzz: someone needs to act, or was named. */
export const PUSH_KINDS: Readonly<Record<string, string>> = {
  "task.assigned": "New task",
  "task.reassigned": "Task handed to you",
  "task.blocked": "Task blocked",
  "task.mentioned": "You were mentioned",
  "task.nudged": "Reminder about a task",
  "task.escalated": "Overdue task escalated",
  "case.assigned": "Code violation case assigned",
  "case.item_assigned": "Violation item assigned",
  "case.inspection_scheduled": "Inspection scheduled",
  "case.escalated": "Violation deadline escalated",
  "crew.submission": "A crew sent something to review",
  "crew_payment.paid": "Crew payment recorded",
  "my_day": "Your day",
};

export type PushDecisionInput = {
  kind: string;
  /** The row's class from classify(); NONE rows are never created. */
  deliveryClass: string;
  /** "actor" = the person who made the change: a receipt, never a buzz. */
  reason: string;
  /** False when this is a repeat of a row already notified this window. */
  created: boolean;
};

export function shouldPush(i: PushDecisionInput): boolean {
  if (!i.created) return false;
  if (i.reason === "actor") return false;
  if (!(i.kind in PUSH_KINDS)) return false;
  return i.deliveryClass === "IMMEDIATE" || i.deliveryClass === "DIGEST";
}

export type PushMessage = { title: string; body: string; data: { path: string } };

/**
 * The visible text. `address` is the job's address line (already free of
 * the customer's name); without one the text says only what happened.
 */
export function pushMessageFor(kind: string, address: string | null, path: string): PushMessage {
  const title = PUSH_KINDS[kind] ?? "KNU Field";
  return {
    title,
    body: address?.trim() ? address.trim() : "Open KNU Field to see it.",
    data: { path },
  };
}

/** The app's screen for a CRM link, or null to just open the app. */
export function appPathFor(subject: { taskId?: string | null; jobId?: string | null }, kind?: string): string {
  // A crew submission opens the review screen, not the job.
  if (kind === "crew.submission") return "/crew-submissions";
  if (subject.taskId) return `/task/${subject.taskId}`;
  if (subject.jobId) return `/job/${subject.jobId}`;
  return "/";
}

const EXPO_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/;
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && EXPO_TOKEN.test(token);
}

/** Expo accepts at most 100 messages per request. */
export function chunk<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The ticket errors that mean "this token will never work again". */
export function tokenIsDead(ticket: { status?: string; details?: { error?: string } }): boolean {
  return ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered";
}
