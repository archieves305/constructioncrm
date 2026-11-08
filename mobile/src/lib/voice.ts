import { LOG_SAFETY_CHECKS, LOG_TEXT_FIELDS, type LogDraftDto } from "@crm/mobile-api";
import { addDays } from "./format";

export type DueChoice = "today" | "tomorrow" | "week" | "date" | "none";

/** A drafted due day as the New task form's choice; any other day is kept as "date". */
export function dueChoice(dueDate: string | null | undefined, today: string): DueChoice {
  if (!dueDate) return "none";
  if (dueDate === today) return "today";
  if (dueDate === addDays(today, 1)) return "tomorrow";
  if (dueDate === addDays(today, 7)) return "week";
  return "date";
}

type LogForm = Partial<Record<(typeof LOG_TEXT_FIELDS)[number], string>> & Partial<Record<(typeof LOG_SAFETY_CHECKS)[number], boolean>>;

/**
 * Lay a spoken draft over the log form: new text goes after what is already
 * written (never replaces it); a safety check moves only when the speaker
 * said so. Returns the form and which sections changed, to point them out.
 */
export function mergeLogDraft(form: LogForm, draft: LogDraftDto): { form: LogForm; changed: string[] } {
  const out: LogForm = { ...form };
  const changed: string[] = [];
  for (const k of LOG_TEXT_FIELDS) {
    const add = draft[k]?.trim();
    if (!add) continue;
    const had = (form[k] ?? "").trim();
    if (had.includes(add)) continue;
    out[k] = had ? `${had}\n${add}` : add;
    changed.push(k);
  }
  for (const k of LOG_SAFETY_CHECKS) {
    const v = draft[k];
    if (typeof v === "boolean" && v !== Boolean(form[k])) {
      out[k] = v;
      changed.push(k);
    }
  }
  return { form: out, changed };
}
