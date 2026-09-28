"use client";

import Link from "next/link";
import { Camera, CheckCircle2, ListChecks, Lock, MapPin, Phone, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { mapsHref, telHref } from "@/components/shared/contact-card";
import { PRIORITY_BADGE_CLASS, STATUS_BADGE_CLASS, STATUS_LABEL } from "@/components/tasks/task-colors";
import { contextLine } from "@/components/calendar/calendar-task-card";
import { formatTime, formatTimeRange } from "@/lib/calendar/agenda";
import { fieldActions } from "@/lib/calendar/field-day";
import type { CalendarItem } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

/**
 * One task on the crew lead's day: a time rail, the address, the title, and
 * a row of `h-11` buttons that work with gloves on. Tapping the body opens
 * the task page; the buttons act in place.
 */
export function FieldDayCard({
  item,
  day,
  busy,
  onStart,
  onDone,
}: {
  item: CalendarItem;
  day: string;
  busy: boolean;
  onStart: (item: CalendarItem) => void;
  onDone: (item: CalendarItem) => void;
}) {
  const a = fieldActions(item, day);
  const closed = item.status === "COMPLETED" || item.status === "CANCELLED";
  const overdue = item.derived === "overdue";
  const when = !item.allDay && item.start && item.end ? formatTimeRange(item.start, item.end) : "All day";
  const rail = !item.allDay && item.start ? formatTime(item.start).replace(/ (AM|PM)$/, "") : "All day";

  return (
    <li className="flex items-stretch gap-2">
      <span className={cn("w-14 shrink-0 pt-4 text-right text-xs font-medium tabular-nums", item.allDay ? "text-muted-foreground/70" : "text-gray-700")} aria-hidden>
        {rail}
      </span>
      <div className={cn("min-w-0 flex-1 rounded-lg border bg-white shadow-xs", overdue && "border-red-300", closed && "opacity-70")}>
        <Link href={`/field/tasks/${item.id}`} className="block min-h-16 px-3 py-3 active:bg-gray-50" aria-label={`${item.title}, ${contextLine(item)}, ${when}`}>
          <p className="truncate text-xs text-muted-foreground">{contextLine(item)}</p>
          <p className={cn("text-base font-semibold leading-snug", closed && "line-through")}>{item.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge className={cn("border-0", overdue ? "bg-red-100 text-red-800" : STATUS_BADGE_CLASS[item.status])}>{overdue ? "Overdue" : STATUS_LABEL[item.status]}</Badge>
            <Badge className={cn("border-0", PRIORITY_BADGE_CLASS[item.priority])}>{item.priority}</Badge>
            <span className="text-muted-foreground">{when}</span>
          </div>
          {item.status === "BLOCKED" && item.blockedReason && (
            <p className="mt-1.5 flex items-start gap-1 text-xs text-amber-800">
              <Lock className="mt-0.5 size-3 shrink-0" /> {item.blockedReason}
            </p>
          )}
        </Link>

        {(!closed || a.directions || a.call) && (
          <div className="flex flex-wrap gap-1.5 border-t px-2 py-2">
            {a.start && (
              <Button variant="outline" className="h-11 min-w-20 flex-1" disabled={busy} onClick={() => onStart(item)}>
                <Play className="size-4" /> Start
              </Button>
            )}
            {a.done && (
              <Button className="h-11 min-w-20 flex-1" disabled={busy} onClick={() => onDone(item)}>
                <CheckCircle2 className="size-4" /> Done
              </Button>
            )}
            {a.directions && (
              <Button variant="outline" className="h-11 flex-1" nativeButton={false} render={<a href={mapsHref(a.directions)} target="_blank" rel="noreferrer" />}>
                <MapPin className="size-4" /> Directions
              </Button>
            )}
            {a.call && (
              <Button variant="outline" className="h-11 flex-1" nativeButton={false} render={<a href={telHref(a.call)} />}>
                <Phone className="size-4" /> Call
              </Button>
            )}
            {a.photoHref && !closed && (
              <Button variant="outline" className="h-11 flex-1" nativeButton={false} render={<Link href={a.photoHref} />}>
                <Camera className="size-4" /> Photo
              </Button>
            )}
            {a.checklist && !closed && (
              <Button variant="outline" className="h-11 flex-1" nativeButton={false} render={<Link href={`/field/tasks/${item.id}#checklist`} />}>
                <ListChecks className="size-4" /> {a.checklist.done}/{a.checklist.total}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
