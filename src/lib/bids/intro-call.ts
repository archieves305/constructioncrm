import { addWorkingDays, type Holidays } from "@/lib/time/working-days";
import { atLocalTime, diffDayKeys, localDateKey, todayKey, type DayKey } from "@/lib/time/zone";

/**
 * The call after a bid goes out (the cadence's first slot, `intro_call`): the
 * bid's PM rings the GC's estimator the next business morning. A GC KNU has
 * never bid to hears who KNU is; one we know is told the bid is in. Pure —
 * the facts are gathered in `onBidSubmitted` (events.ts).
 */

export const INTRO_CALL_SLOT = "intro_call";
/** A submission recorded this long after it went out is history: no call. */
export const INTRO_CALL_MAX_AGE_DAYS = 14;
export const INTRO_CALL_HOUR = 9;

export type IntroCallContact = { name: string; title?: string | null; phone?: string | null; mobile?: string | null; email?: string | null };

export type IntroCallInput = {
  submittedAt: Date;
  now: Date;
  holidays: Holidays;
  tz: string;
  isFirstWithGc: boolean;
  gc: string;
  project: string;
  bidNumber: string;
  scopes: string[];
  amount: number;
  /** Who to call, best first: the people it was sent to, else the bid's contact, else the account's primary. */
  contacts: IntroCallContact[];
  /** The GC's account page, for when there is nobody to call yet. */
  accountUrl: string;
};

export type IntroCallPlan = { dueAt: Date; dueDay: DayKey; title: string; description: string };

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function contactLine(c: IntroCallContact): string {
  const reach = [c.phone && `office ${c.phone}`, c.mobile && `mobile ${c.mobile}`, !c.phone && !c.mobile && c.email && `email ${c.email} (no phone on file)`].filter(Boolean).join(", ");
  return `- ${c.name}${c.title ? `, ${c.title}` : ""}${reach ? ` — ${reach}` : " — no phone or email on file"}`;
}

/** Where the person in the bid's chair should call, and what to say. `null` when the submission is too old to call about. */
export function introCallPlan(i: IntroCallInput): IntroCallPlan | null {
  const today = todayKey(i.now, i.tz);
  if (diffDayKeys(localDateKey(i.submittedAt, i.tz), today) > INTRO_CALL_MAX_AGE_DAYS) return null;
  const dueDay = addWorkingDays(today, 1, i.holidays);
  const dueAt = atLocalTime(dueDay, INTRO_CALL_HOUR, 0, i.tz);
  const scopes = i.scopes.length ? i.scopes.join(", ") : "our scope";

  const title = i.isFirstWithGc ? `Call ${i.gc}: introduce KNU — we bid ${i.project}` : `Call ${i.gc}: we bid ${i.project} — confirm they have it`;

  const who = i.contacts.length
    ? ["Who to call:", ...i.contacts.map(contactLine)].join("\n")
    : `Who to call: nobody is on file for ${i.gc} yet — find their estimator on the account page (${i.accountUrl}), add them as a contact, then call.`;

  const script = i.isFirstWithGc
    ? [
        `This is our first bid to ${i.gc}. Introduce KNU before the bid gets lost in their inbox:`,
        `1. Who we are: KNU Construction, a South Florida subcontractor — the trades we self-perform and a recent job like this one.`,
        `2. What we sent: ${scopes} on ${i.project}, ${money(i.amount)} (${i.bidNumber}). Ask them to confirm they received it and whether anything is missing or unclear.`,
        `3. Their timing: when do they expect the owner's award, and when will they pick subs?`,
        `4. Who follows up: who on their side buys this scope, and how they prefer to be reached.`,
        `5. Ask what else they are bidding that we could price, and whether they need our prequalification package.`,
      ]
    : [
        `We have bid to ${i.gc} before. A short call to let them know this one is in:`,
        `1. What we sent: ${scopes} on ${i.project}, ${money(i.amount)} (${i.bidNumber}). Confirm they received it and answer any questions.`,
        `2. Their timing: when do they expect the owner's award, and when will they pick subs?`,
        `3. Anything they need from us — clarifications, alternates, a revised number.`,
      ];

  const description = [...script, "", who, "", `After the call: Log interaction on ${i.gc}'s account page (${i.accountUrl}) with what they said and the next date.`].join("\n");
  return { dueAt, dueDay, title, description };
}

/** "Fri 9:00 AM" for a toast. */
export function dueLabel(dueAt: Date, tz: string): string {
  return dueAt.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" });
}
