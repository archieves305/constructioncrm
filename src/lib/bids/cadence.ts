import { z } from "zod";
import type { BidPrimeStatus } from "@/generated/prisma/enums";
import { addWorkingDays, onOrNextWorkingDay, type Holidays } from "@/lib/time/working-days";
import { addDayKeys, atLocalTime, diffDayKeys, localDateKey, type DayKey } from "@/lib/time/zone";

/**
 * The follow-up cadence of one GC opportunity after its bid went out
 * (PlanHub plan §6). Pure: the facts come in, the slots come out; the runner
 * (`follow-ups.ts`) writes them as BidFollowUpAction rows, once per slot key.
 *
 * - Anchor ("closing date"): a date a person set, else the GC's sub deadline,
 *   else the first submission. A bid sent after the deadline anchors on its
 *   submission. No submission, no cadence (the intro call has its own event).
 * - Steps: +5 business days an email, +10 a call, +20 an email, then every 15
 *   alternating call / email. Business days skip weekends and company
 *   holidays.
 * - A date the GC asked for wins: steps before it are dropped and a call is
 *   planned that morning. An expected award date adds a call the business
 *   day after it.
 * - A pause holds email steps (a reply came in) or every step (a person
 *   paused it) until its date.
 * - 90 calendar days with no meaningful contact: a review task. Silence never
 *   closes a bid — a person decides.
 * - Only the latest overdue slot is raised; earlier ones are recorded as
 *   superseded, so importing an old bid never raises a burst.
 */

export type SlotKind = "CALL" | "EMAIL" | "REVIEW";

export const cadenceConfigSchema = z.object({
  steps: z.array(z.object({ days: z.number().int().min(1).max(250), kind: z.enum(["CALL", "EMAIL"]) })).min(1).max(12),
  repeatEveryDays: z.number().int().min(1).max(120),
  repeatCount: z.number().int().min(0).max(24),
  reviewAfterCalendarDays: z.number().int().min(7).max(365),
});
export type CadenceConfig = z.infer<typeof cadenceConfigSchema>;

export const DEFAULT_CADENCE: CadenceConfig = {
  steps: [
    { days: 5, kind: "EMAIL" },
    { days: 10, kind: "CALL" },
    { days: 20, kind: "EMAIL" },
  ],
  repeatEveryDays: 15,
  repeatCount: 4,
  reviewAfterCalendarDays: 90,
};

/** The settings row's JSON, else the code default (a bad value never breaks the run). */
export function cadenceConfig(json: unknown): CadenceConfig {
  const r = cadenceConfigSchema.safeParse(json);
  return r.success ? r.data : DEFAULT_CADENCE;
}

export type CadenceFacts = {
  now: Date;
  tz: string;
  holidays: Holidays;
  config: CadenceConfig;
  callHour: number;
  draftHour: number;
  /** The opportunity is still open and has gone out (SUBMITTED / SHORTLISTED). */
  open: boolean;
  /** The project is postponed / rebidding / cancelled / closed: nothing is planned. */
  projectOnHold: boolean;
  firstSubmittedAt: Date | null;
  bidDueAt: Date | null;
  cadenceAnchorAt: Date | null;
  requestedFollowUpAt: Date | null;
  expectedAwardAt: Date | null;
  pausedUntil: Date | null;
  pauseScope: string | null;
  primeStatus: BidPrimeStatus;
  lastMeaningfulContactAt: Date | null;
  /** No address to write to (no contact with an email, or the contact asked for no more email): email steps become calls. */
  canEmail: boolean;
};

export type AnchorSource = "set" | "deadline" | "submission";
export type Anchor = { day: DayKey; source: AnchorSource };

export const ANCHOR_LABEL: Record<AnchorSource, string> = {
  set: "the date set on this bid",
  deadline: "the GC's bid deadline",
  submission: "the day the bid went out (it went after the deadline, or there is none)",
};

export type PlannedSlot = {
  slotKey: string;
  kind: SlotKind;
  reason: "post_close" | "requested" | "award_watch" | "review_90";
  dueDay: DayKey;
  dueAt: Date;
  /** One line for the card and the task: why this exists. */
  why: string;
};

export function anchorOf(f: Pick<CadenceFacts, "cadenceAnchorAt" | "bidDueAt" | "firstSubmittedAt" | "tz">): Anchor | null {
  if (f.cadenceAnchorAt) return { day: localDateKey(f.cadenceAnchorAt, f.tz), source: "set" };
  if (!f.firstSubmittedAt) return null;
  if (f.bidDueAt && f.firstSubmittedAt.getTime() <= f.bidDueAt.getTime()) return { day: localDateKey(f.bidDueAt, f.tz), source: "deadline" };
  return { day: localDateKey(f.firstSubmittedAt, f.tz), source: "submission" };
}

/** The post-close steps with their business-day offsets: the listed steps, then the repeats alternating with the last kind. */
export function stepOffsets(c: CadenceConfig): { days: number; kind: "CALL" | "EMAIL" }[] {
  const out = [...c.steps].sort((a, b) => a.days - b.days);
  let last = out[out.length - 1]!;
  for (let i = 0; i < c.repeatCount; i++) {
    last = { days: last.days + c.repeatEveryDays, kind: last.kind === "CALL" ? "EMAIL" : "CALL" };
    out.push(last);
  }
  return out;
}

/** Every slot this opportunity should have, oldest first. Empty while closed, on hold or not yet sent. */
export function planCadence(f: CadenceFacts): { anchor: Anchor | null; slots: PlannedSlot[] } {
  const anchor = anchorOf(f);
  if (!f.open || f.projectOnHold || !anchor) return { anchor, slots: [] };
  const at = (day: DayKey, kind: SlotKind) => atLocalTime(day, kind === "EMAIL" ? f.draftHour : f.callHour, 0, f.tz);
  const requestedDay = f.requestedFollowUpAt ? onOrNextWorkingDay(localDateKey(f.requestedFollowUpAt, f.tz), f.holidays) : null;
  const pauseDay = f.pausedUntil ? localDateKey(f.pausedUntil, f.tz) : null;
  const paused = (day: DayKey, kind: SlotKind) =>
    pauseDay !== null && diffDayKeys(day, pauseDay) > 0 && (f.pauseScope === "all" || kind === "EMAIL");

  const slots: PlannedSlot[] = [];
  for (const s of stepOffsets(f.config)) {
    const day = addWorkingDays(anchor.day, s.days, f.holidays);
    // The GC asked us to wait: nothing before the day they named.
    if (requestedDay && diffDayKeys(day, requestedDay) > 0) continue;
    const kind: SlotKind = s.kind === "EMAIL" && !f.canEmail ? "CALL" : s.kind;
    if (paused(day, kind)) continue;
    slots.push({
      slotKey: `post:${s.days}`,
      kind,
      reason: "post_close",
      dueDay: day,
      dueAt: at(day, kind),
      why: `${s.days} business days after ${ANCHOR_LABEL[anchor.source].split(" (")[0]}${kind !== s.kind ? " (a call: no email address to use)" : ""}`,
    });
  }
  if (requestedDay && !paused(requestedDay, "CALL")) {
    slots.push({ slotKey: `requested:${requestedDay}`, kind: "CALL", reason: "requested", dueDay: requestedDay, dueAt: at(requestedDay, "CALL"), why: "the date the GC asked us to follow up" });
  }
  if (f.expectedAwardAt && f.primeStatus !== "GC_LOST" && f.primeStatus !== "CANCELLED") {
    const day = addWorkingDays(localDateKey(f.expectedAwardAt, f.tz), 1, f.holidays);
    if (!paused(day, "CALL")) slots.push({ slotKey: `award_watch:${day}`, kind: "CALL", reason: "award_watch", dueDay: day, dueAt: at(day, "CALL"), why: "the business day after the GC expects the owner's award" });
  }
  const base = f.lastMeaningfulContactAt && f.lastMeaningfulContactAt.getTime() > atLocalTime(anchor.day, 0, 0, f.tz).getTime() ? localDateKey(f.lastMeaningfulContactAt, f.tz) : anchor.day;
  const reviewDay = onOrNextWorkingDay(addDayKeys(base, f.config.reviewAfterCalendarDays), f.holidays);
  slots.push({ slotKey: `review_90:${base}`, kind: "REVIEW", reason: "review_90", dueDay: reviewDay, dueAt: at(reviewDay, "CALL"), why: `${f.config.reviewAfterCalendarDays} days with no meaningful update — decide where this bid stands` });

  slots.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.slotKey.localeCompare(b.slotKey));
  return { anchor, slots };
}

/**
 * What to write now: the latest due slot not yet on record is raised, the
 * earlier due ones are superseded. A review is raised on its own — it asks
 * for a decision, not another touch.
 */
export function slotsToRaise(slots: PlannedSlot[], recorded: ReadonlySet<string>, now: Date): { raise: PlannedSlot[]; supersede: PlannedSlot[] } {
  const due = slots.filter((s) => s.dueAt.getTime() <= now.getTime() && !recorded.has(s.slotKey));
  const touches = due.filter((s) => s.kind !== "REVIEW");
  const reviews = due.filter((s) => s.kind === "REVIEW");
  const latest = touches[touches.length - 1];
  return { raise: [...(latest ? [latest] : []), ...reviews], supersede: touches.slice(0, -1) };
}

/** The next slot still ahead, for the card and `nextActionAt`. */
export function nextPlanned(slots: PlannedSlot[], recorded: ReadonlySet<string>, now: Date): PlannedSlot | null {
  return slots.find((s) => s.dueAt.getTime() > now.getTime() && !recorded.has(s.slotKey)) ?? null;
}

const KIND_WORD: Record<SlotKind, string> = { CALL: "Call", EMAIL: "Email", REVIEW: "Review" };

/** "Email Acme: following up on Lakeside Plaza (BID-00012)" — the task / action title. */
export function slotTitle(s: Pick<PlannedSlot, "kind" | "reason">, gc: string, project: string, bidNumber: string): string {
  if (s.kind === "REVIEW") return `Review ${bidNumber} with ${gc}: no update in a long time — decide where it stands`;
  if (s.reason === "requested") return `Call ${gc}: the date they asked us to follow up on ${project}`;
  if (s.reason === "award_watch") return `Call ${gc}: has the owner awarded ${project}?`;
  return `${KIND_WORD[s.kind]} ${gc}: following up on ${project} (${bidNumber})`;
}
