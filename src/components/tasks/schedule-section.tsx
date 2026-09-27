"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarDays, Clock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TouchTimeField } from "@/components/field/touch-time-field";
import { useIsPhone } from "@/components/shared/use-media-query";
import { formatTimeRange } from "@/lib/calendar/agenda";
import { dayKey, dayKeyToLocalDate, type DayKey } from "@/lib/time/zone";
import { DueDatePresets } from "./due-date-presets";

/**
 * When a task happens: the day, whether it has a time, and the window.
 *
 * Every change is one PATCH to /api/tasks/[id]; the server's applySchedule
 * keeps the fields consistent (a new day moves a timed window with it, an
 * end before the start is refused). Times are typed and read in the
 * browser's zone — the office and its browsers share one zone today, and the
 * card shows whatever the server stored.
 */

type ScheduleTask = {
  dueAt: string | null;
  scheduledStart?: string | null;
  allDay?: boolean;
};

export type SchedulePatch = { dueAt?: string | null; scheduledStart?: string | null; allDay?: boolean };

function hhmm(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

function minutesOf(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function toIso(day: DayKey, minutes: number): string {
  const d = dayKeyToLocalDate(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.toISOString();
}

function parseHhmm(v: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function ScheduleSection({ task, canEdit, onPatch, pending }: { task: ScheduleTask; canEdit: boolean; onPatch: (p: SchedulePatch) => void; pending?: boolean }) {
  const isPhone = useIsPhone();
  const allDay = task.allDay ?? true;
  const day = task.dueAt ? dayKey(new Date(task.dueAt)) : "";
  const startDay = task.scheduledStart ? dayKey(new Date(task.scheduledStart)) : null;
  const isSpan = allDay && Boolean(startDay) && startDay !== day;
  const [spanOpen, setSpanOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startMin = !allDay && task.scheduledStart ? minutesOf(task.scheduledStart) : null;
  const endMin = !allDay && task.dueAt ? minutesOf(task.dueAt) : null;

  function setTimes(nextStart: number | null, nextEnd: number | null) {
    if (!day || nextStart === null || nextEnd === null) return;
    if (nextStart >= nextEnd) {
      setError("The start must be before the end.");
      return;
    }
    setError(null);
    onPatch({ scheduledStart: toIso(day, nextStart), dueAt: toIso(day, nextEnd), allDay: false });
  }

  if (!canEdit) {
    return (
      <div>
        <dt className="text-xs text-muted-foreground">Scheduled</dt>
        <dd className="font-medium text-gray-800">
          {!task.dueAt
            ? "No date yet"
            : isSpan && task.scheduledStart
              ? `${format(dayKeyToLocalDate(startDay!), "EEE, MMM d")} – ${format(dayKeyToLocalDate(day), "EEE, MMM d, yyyy")}`
              : `${format(dayKeyToLocalDate(day), "EEE, MMM d, yyyy")}${!allDay && task.scheduledStart ? ` · ${formatTimeRange(task.scheduledStart, task.dueAt)}` : " · All day"}`}
        </dd>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1 text-xs">
        <CalendarDays className="size-3.5" /> Scheduled
      </Label>
      <DueDatePresets value={day} onChange={(d) => onPatch({ dueAt: d || null })} />

      {day && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={allDay} disabled={pending} onCheckedChange={(c) => onPatch({ allDay: Boolean(c) })} />
            All day
          </label>
          {allDay && !isSpan && !spanOpen && (
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => setSpanOpen(true)}>
              + Make this multi-day
            </button>
          )}
        </div>
      )}

      {day && allDay && (isSpan || spanOpen) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-muted-foreground">Starts</span>
          <Input
            type="date"
            className="h-8 w-[160px] text-sm"
            max={day}
            value={startDay && isSpan ? startDay : ""}
            onChange={(e) => {
              if (!e.target.value) return;
              onPatch({ scheduledStart: e.target.value });
              setSpanOpen(false);
            }}
            aria-label="First day"
          />
          <span className="text-xs text-muted-foreground">and is due {format(dayKeyToLocalDate(day), "EEE, MMM d")}</span>
          {isSpan && (
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => onPatch({ scheduledStart: null })}>
              Single day
            </button>
          )}
        </div>
      )}

      {day && !allDay && (
        <div className="space-y-1">
          {isPhone ? (
            <div className="grid gap-2">
              <TouchTimeField label="Start" value={startMin} defaultValue={9 * 60} onChange={(m) => setTimes(m, endMin ?? (m ?? 0) + 60)} />
              <TouchTimeField label="End" value={endMin} defaultValue={10 * 60} onChange={(m) => setTimes(startMin ?? (m ?? 60) - 60, m)} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Clock className="size-3.5 text-muted-foreground" aria-hidden />
              <Input
                type="time"
                step={900}
                className="h-8 w-[120px] text-sm"
                value={task.scheduledStart ? hhmm(task.scheduledStart) : ""}
                onChange={(e) => {
                  const m = parseHhmm(e.target.value);
                  if (m !== null) setTimes(m, endMin);
                }}
                aria-label="Start time"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="time"
                step={900}
                className="h-8 w-[120px] text-sm"
                value={task.dueAt ? hhmm(task.dueAt) : ""}
                onChange={(e) => {
                  const m = parseHhmm(e.target.value);
                  if (m !== null) setTimes(startMin, m);
                }}
                aria-label="End time"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-tone-danger-fg">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
