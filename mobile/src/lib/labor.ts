import { LABOR_INPUT_FIELDS, type CrewMemberDto, type LaborEntryDto, type LaborEntryInput } from "@crm/mobile-api";
import { OFFICE_TZ } from "./format";

/** The web crew sheet's defaults: 7:00 AM – 3:30 PM with a 30-minute break. */
export const DEFAULT_START = 7 * 60;
export const DEFAULT_END = 15 * 60 + 30;
export const BREAKS = [0, 30, 60] as const;
const MAX = 2879; // the CRM allows past midnight, up to the next day's 23:59

/** Hours worked as the sheet stands (the CRM splits regular / overtime). */
export function entryHours(e: Pick<LaborEntryInput, "startMinutes" | "endMinutes" | "breakMinutes" | "isAbsent">): number {
  if (e.isAbsent || e.startMinutes == null || e.endMinutes == null) return 0;
  const worked = e.endMinutes - e.startMinutes - (e.breakMinutes ?? 0);
  return worked > 0 ? Math.round((worked / 60) * 100) / 100 : 0;
}

export function sheetHours(entries: LaborEntryInput[]): number {
  return Math.round(entries.reduce((s, e) => s + entryHours(e), 0) * 100) / 100;
}

/** "7:00 AM"; past midnight reads "1:30 AM (next day)". */
export function clock(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const nextDay = minutes >= 1440;
  const m = minutes % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const label = `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
  return nextDay ? `${label} (next day)` : label;
}

/** Move a time by `delta` minutes, landing on the step and inside the CRM's range. */
export function stepTime(minutes: number | null | undefined, delta: number, fallback: number): number {
  const from = minutes ?? fallback;
  const stepped = Math.round((from + delta) / Math.abs(delta)) * Math.abs(delta);
  return Math.min(MAX, Math.max(0, stepped));
}

/**
 * Minutes after midnight in the office's time zone, rounded to 5 minutes
 * ("Start now" / "Stop now"). For the end of a day that began yesterday,
 * pass `after` (the start): a time before it is read as past midnight.
 */
export function nowMinutes(at: Date = new Date(), after?: number | null): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: OFFICE_TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  let mins = Math.round((h * 60 + m) / 5) * 5;
  if (after != null && mins < after) mins += 1440;
  return Math.min(MAX, mins);
}

export function newEntry(person: CrewMemberDto, id: string): LaborEntryInput {
  return {
    id,
    personnelId: person.id,
    trade: person.trade ?? null,
    jobAreaId: null,
    workArea: null,
    startMinutes: DEFAULT_START,
    endMinutes: DEFAULT_END,
    breakMinutes: 30,
    costCodeId: null,
    phase: null,
    budgetLineId: null,
    isAbsent: false,
    isLate: false,
    leftEarly: false,
    absenceReason: null,
    notes: null,
  };
}

/**
 * What a save sends for one entry: every field the CRM takes back, as the
 * phone has it (fields the office set ride along untouched), nothing else.
 */
export function toInput(e: LaborEntryInput | LaborEntryDto): LaborEntryInput {
  const src = e as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of LABOR_INPUT_FIELDS) out[k] = src[k] ?? (k === "breakMinutes" ? 0 : k === "isAbsent" || k === "isLate" || k === "leftEarly" ? false : null);
  return out as LaborEntryInput;
}

/** Absent: no times, no hours, and the reason kept. */
export function markAbsent(e: LaborEntryInput, absent: boolean): LaborEntryInput {
  return absent
    ? { ...e, isAbsent: true, startMinutes: null, endMinutes: null }
    : { ...e, isAbsent: false, absenceReason: null, startMinutes: e.startMinutes ?? DEFAULT_START, endMinutes: e.endMinutes ?? DEFAULT_END };
}

export function personName(p: { firstName: string; lastName: string } | null | undefined): string {
  return p ? `${p.firstName} ${p.lastName}`.trim() : "Unknown worker";
}

// ── Clocking the crew (today's sheet) ───────────────────────────────────────

/** On site now: here, started, not yet clocked out. */
export function isOnSite(e: Pick<LaborEntryInput, "isAbsent" | "startMinutes" | "endMinutes">): boolean {
  return !e.isAbsent && e.startMinutes != null && e.endMinutes == null;
}

/** Hours so far for someone still on site (break taken off), else their sheet hours. */
export function hoursSoFar(e: LaborEntryInput, at: Date = new Date()): number {
  if (!isOnSite(e)) return entryHours(e);
  const worked = nowMinutes(at, e.startMinutes) - (e.startMinutes ?? 0) - (e.breakMinutes ?? 0);
  return worked > 0 ? Math.round((worked / 60) * 10) / 10 : 0;
}

/**
 * Clock people in at `at`: someone not on the sheet is added, started now,
 * with no end and no break yet; someone marked absent who turns up is put on
 * site from now. Anyone already on the sheet otherwise is left alone.
 */
export function clockIn(entries: LaborEntryInput[], people: CrewMemberDto[], makeId: () => string, at: Date = new Date()): LaborEntryInput[] {
  const start = nowMinutes(at);
  const next = [...entries];
  for (const p of people) {
    const i = next.findIndex((e) => e.personnelId === p.id);
    if (i === -1) next.push({ ...newEntry(p, makeId()), startMinutes: start, endMinutes: null, breakMinutes: 0 });
    else if (next[i].isAbsent) next[i] = { ...next[i], isAbsent: false, absenceReason: null, startMinutes: start, endMinutes: null };
  }
  return next;
}

/** Clock out the given entries (all on site when `ids` is omitted) at `at`; past midnight counts on. */
export function clockOut(entries: LaborEntryInput[], ids: string[] | null, at: Date = new Date()): LaborEntryInput[] {
  return entries.map((e) => (isOnSite(e) && (!ids || ids.includes(e.id)) ? { ...e, endMinutes: Math.max((e.startMinutes ?? 0) + 5, nowMinutes(at, e.startMinutes)) } : e));
}
