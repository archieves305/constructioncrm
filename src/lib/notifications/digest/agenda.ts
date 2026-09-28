import { format } from "date-fns";
import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { itemsByDay, formatTimeRange } from "@/lib/calendar/agenda";
import { toCalendarItem } from "@/lib/calendar/items";
import { loadOverlays } from "@/lib/calendar/overlays-load";
import { buildCalendarWhere } from "@/lib/calendar/query";
import { CALENDAR_ITEM_SELECT } from "@/lib/calendar/select";
import type { CalendarItem } from "@/lib/calendar/types";
import { jobTextWithCustomer } from "@/lib/labels/job";
import { formatAddressLine } from "@/lib/labels/address";
import { describeFrom, describeWhen, loadDueReminders, loadJobStarts, loadScheduleChanges, type ReminderTask, type ScheduleChange } from "@/lib/tasks/reminders";
import { addDayKeys, dayKey, dayKeyToLocalDate, endOfDayIn, startOfDayIn, todayKey } from "@/lib/time/zone";
import { visibilityScopeFor } from "@/lib/workflows/visibility";
import { paths } from "../links";
import type { DigestSlot } from "../windows";
import type { AgendaModel } from "./render";

/**
 * What is on a person's calendar, for the top of their digest. Reads the
 * same query the Calendar's Day view and /field/day read (`users=me`), so
 * the email and the screen never disagree. Morning = today plus anything
 * overdue, plus the day's schedule changes, reminders and job starts (the
 * old 7:30 task digest, folded in); midday / afternoon = the rest of today;
 * evening = tomorrow.
 */

export type AgendaResult = {
  model: AgendaModel | null;
  /** Custom reminders carried by this digest — retire them once it is sent. */
  reminderTaskIds: string[];
};

const OVERDUE_LOOKBACK_DAYS = 30;

function contextOf(i: CalendarItem): string {
  if (i.job) return jobTextWithCustomer(i.job);
  if (i.violationCase) return `Case ${i.violationCase.caseNumber}`;
  if (i.lead) return formatAddressLine(i.lead) || i.lead.fullName;
  return "No job";
}

function whenOf(i: CalendarItem): string {
  if (!i.allDay && i.start && i.end) return formatTimeRange(i.start, i.end);
  return "All day";
}

function hrefOf(i: CalendarItem): string {
  if (i.overlay) return i.overlay.href;
  return paths.task(i.id);
}

async function loadRange(user: { id: string; role: RoleName }, from: string, to: string, now: Date, includeCompleted: boolean): Promise<CalendarItem[]> {
  const scope = await visibilityScopeFor(user);
  const params = { from, to, users: "me", includeCompleted };
  const where = buildCalendarWhere(params, { kind: "me" }, user, scope);
  const [rows, overlays] = await Promise.all([
    prisma.task.findMany({ where, select: CALENDAR_ITEM_SELECT, orderBy: [{ dueAt: "asc" }, { priority: "desc" }], take: 300 }),
    loadOverlays(params, { kind: "me" }, user, scope, now),
  ]);
  return [...rows.map((r) => toCalendarItem(r, now)), ...overlays];
}

export async function loadAgenda(user: { id: string; role: RoleName }, slot: DigestSlot, now: Date): Promise<AgendaResult> {
  const today = todayKey(now);
  const tomorrow = addDayKeys(today, 1);
  const day = slot === "evening" ? tomorrow : today;
  const heading = slot === "evening" ? `Tomorrow, ${format(dayKeyToLocalDate(tomorrow), "EEEE, MMMM d")}` : slot === "morning" ? "Today" : "Rest of today";

  const items: AgendaModel["items"] = [];
  const seen = new Set<string>();
  const push = (i: CalendarItem, tone: AgendaModel["items"][number]["tone"], when?: string) => {
    if (seen.has(i.id)) return;
    seen.add(i.id);
    items.push({ title: i.title, when: when ?? whenOf(i), context: contextOf(i), href: hrefOf(i), tone: i.overlay ? "event" : tone });
  };

  if (slot === "morning") {
    const overdue = (await loadRange(user, addDayKeys(today, -OVERDUE_LOOKBACK_DAYS), addDayKeys(today, -1), now, false)).filter((i) => i.derived === "overdue" && !i.overlay);
    for (const i of overdue) push(i, "overdue", `Overdue since ${format(dayKeyToLocalDate(i.dayKey ?? today), "MMM d")}`);
  }
  const dayItems = itemsByDay(await loadRange(user, day, day, now, false), { from: day, to: day }).get(day) ?? [];
  for (const i of dayItems) {
    // After the morning, only what is still ahead of us matters.
    if (slot !== "morning" && slot !== "evening" && !i.allDay && i.end && new Date(i.end) < now) continue;
    push(i, slot === "evening" ? "upcoming" : "today");
  }

  let changes: AgendaModel["changes"] = [];
  let starting: AgendaModel["starting"] = [];
  const reminderTaskIds: string[] = [];
  if (slot === "morning") {
    const todayStart = startOfDayIn(today);
    const todayEnd = endOfDayIn(today);
    const [allChanges, starts, reminders] = await Promise.all([loadScheduleChanges(new Date(now.getTime() - 24 * 3_600_000)), loadJobStarts(todayStart, todayEnd), loadDueReminders(todayEnd)]);
    const latest = new Map<string, ScheduleChange>();
    for (const c of allChanges) {
      if (c.task.assignedUserId !== user.id) continue;
      const prev = latest.get(c.taskId);
      if (!prev || c.createdAt > prev.createdAt) latest.set(c.taskId, c);
    }
    changes = Array.from(latest.values()).map((c) => ({
      title: c.task.title,
      from: describeFrom(c),
      to: describeWhen(c.task),
      byName: c.actor ? `${c.actor.firstName} ${c.actor.lastName}`.trim() : null,
      href: paths.task(c.taskId),
    }));
    starting = starts.filter((s) => s.userIds.includes(user.id)).map((s) => ({ title: s.title, href: paths.job(s.id) }));
    const mine = reminders.filter((r: ReminderTask) => (r.assignedUserId ?? r.createdByUserId) === user.id || r.remindSetByUserId === user.id);
    for (const r of mine) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        items.push({ title: r.title, when: r.dueAt ? `Due ${format(dayKeyToLocalDate(dayKey(r.dueAt)), "MMM d")}` : "Reminder", context: `${r.job ? jobTextWithCustomer(r.job) : (r.lead?.fullName ?? "No job or lead")} · you asked to be reminded`, href: paths.task(r.id), tone: "today" });
      }
      if ((r.assignedUserId ?? r.createdByUserId) === user.id) reminderTaskIds.push(r.id);
    }
  }

  if (items.length === 0 && changes.length === 0 && starting.length === 0) return { model: null, reminderTaskIds };
  return { model: { heading, items, changes, starting }, reminderTaskIds };
}
