import { z } from "zod";

/**
 * The feature-usage log's vocabulary. Pure, client-safe. Only these names are
 * stored; a page path is reduced to its pattern (ids and dates removed) so no
 * record id, name or content is ever kept.
 */
export const USAGE_EVENTS = [
  // the phone app
  "app_opened",
  "today_opened",
  "task_opened",
  "job_opened",
  "files_opened",
  "document_opened",
  "photo_viewed",
  "daily_log_opened",
  "crew_hours_opened",
  "owner_opened",
  "task_reassigned",
  "task_rescheduled",
  "tasks_bulk_changed",
  "note_saved",
  "voice_draft_used",
  // the web CRM
  "page_viewed",
] as const;
export type UsageEventName = (typeof USAGE_EVENTS)[number];

export const USAGE_SOURCES = ["phone", "web"] as const;

/** Kinds of record an event may name (never which one). */
export const SUBJECT_TYPES = ["task", "job", "lead", "file", "photo", "log", "page"] as const;

export const usageBatchSchema = z.object({
  source: z.enum(USAGE_SOURCES),
  events: z
    .array(
      z.object({
        event: z.enum(USAGE_EVENTS),
        /** For page_viewed: the path pattern (see pagePattern); else a SUBJECT_TYPES kind. */
        subject: z.string().max(120).optional(),
        at: z.string().datetime(),
      }),
    )
    .min(1)
    .max(200),
});

const ID = /^c[a-z0-9]{19,31}$|^[0-9a-f-]{32,36}$|^\d+$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "/jobs/cmo789…/daily-logs/2026-11-08?x=1" → "/jobs/:id/daily-logs/:date". */
export function pagePattern(path: string): string {
  const clean = path.split(/[?#]/)[0] || "/";
  const parts = clean.split("/").map((seg) => (ID.test(seg) ? ":id" : DATE.test(seg) ? ":date" : seg.length > 40 ? ":x" : seg));
  return parts.join("/").slice(0, 120) || "/";
}

/** The subject to store: a known kind, or a path pattern for page views. */
export function subjectFor(event: UsageEventName, subject: string | undefined): string | null {
  if (!subject) return null;
  if (event === "page_viewed") return pagePattern(subject);
  return (SUBJECT_TYPES as readonly string[]).includes(subject) ? subject : null;
}

/** An event's time, kept within the last 7 days and never in the future. */
export function clampAt(at: string, now: number): Date {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return new Date(now);
  return new Date(Math.min(now, Math.max(now - 7 * 86_400_000, t)));
}
