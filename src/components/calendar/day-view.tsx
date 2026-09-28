"use client";

import { Plus } from "lucide-react";
import { Callout } from "@/components/shared/callout";
import { BAND_LABEL, BAND_START_HOUR, BANDS, formatTime, groupByBand, type Band } from "@/lib/calendar/agenda";
import type { CalendarItem } from "@/lib/calendar/types";
import type { DayKey } from "@/lib/time/zone";
import { cn } from "@/lib/utils";
import { CalendarTaskCard } from "./calendar-task-card";
import { DraggableCard } from "./draggable-card";
import { DropZone } from "./drop-zone";

/**
 * One day as an agenda: what is overdue (today only), then All day, Morning,
 * Afternoon, Evening. A time rail on the left gives timed work a place to be
 * read top-to-bottom the way a paper schedule does. No hour-pixel grid: the
 * office's work is mostly all-day, and a list is what a phone can hold.
 */
export function DayView({
  day,
  items,
  overdue = [],
  onOpen,
  onAddAt,
  showAssignee,
}: {
  day: DayKey;
  items: CalendarItem[];
  /** Open work from earlier days — shown only when `day` is today. */
  overdue?: CalendarItem[];
  onOpen: (id: string) => void;
  /** Add a task on this day, optionally at an hour (null = all day). */
  onAddAt?: (day: DayKey, hour: number | null) => void;
  showAssignee: boolean;
}) {
  const bands = groupByBand(items);
  const nothing = items.length === 0;

  return (
    <div className="space-y-4">
      {overdue.length > 0 && (
        <Callout tone="danger" title={`${overdue.length} overdue ${overdue.length === 1 ? "task" : "tasks"} from earlier days`}>
          <ul className="mt-2 space-y-1.5">
            {overdue.map((i) => (
              <li key={i.id}>
                <CalendarTaskCard item={i} onOpen={onOpen} showAssignee={showAssignee} variant="compact" />
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {BANDS.map((band) => {
        const list = bands[band];
        if (list.length === 0 && (nothing || !onAddAt)) return null;
        return <BandSection key={band} day={day} band={band} items={list} onOpen={onOpen} onAdd={onAddAt ? () => onAddAt(day, band === "allDay" ? null : BAND_START_HOUR[band]) : undefined} showAssignee={showAssignee} />;
      })}

      {onAddAt && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <span>Add at</span>
          {([8, 9, 10, 13, 15] as const).map((h) => (
            <button key={h} type="button" onClick={() => onAddAt(day, h)} className="rounded-full border px-2 py-0.5 hover:bg-gray-50 hover:text-foreground">
              {h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`}
            </button>
          ))}
          <button type="button" onClick={() => onAddAt(day, null)} className="rounded-full border px-2 py-0.5 hover:bg-gray-50 hover:text-foreground">
            All day
          </button>
        </div>
      )}
    </div>
  );
}

function BandSection({ day, band, items, onOpen, onAdd, showAssignee }: { day: DayKey; band: Band; items: CalendarItem[]; onOpen: (id: string) => void; onAdd?: () => void; showAssignee: boolean }) {
  const headingId = `cal-band-${band}`;
  // Dropping on "All day" puts the task on the day; on a timed band, at the band's start.
  const target = band === "allDay" ? ({ kind: "day", day } as const) : ({ kind: "slot", day, hour: BAND_START_HOUR[band], minute: 0 } as const);
  return (
    <section aria-labelledby={headingId}>
      <DropZone target={target} label={BAND_LABEL[band]} className="p-0.5 -m-0.5">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {BAND_LABEL[band]}
          {items.length > 0 && <span className="ml-1.5 font-normal normal-case tabular-nums">{items.length}</span>}
        </h3>
        {onAdd && (
          <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-label={`Add a task, ${BAND_LABEL[band].toLowerCase()}`}>
            <Plus className="size-3.5" /> Add
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">Nothing {band === "allDay" ? "all-day" : `this ${BAND_LABEL[band].toLowerCase()}`}.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <span className={cn("w-16 shrink-0 pt-2 text-right text-xs tabular-nums", item.allDay ? "text-transparent" : "text-muted-foreground")} aria-hidden={item.allDay}>
                {item.allDay || !item.start ? "—" : formatTime(item.start)}
              </span>
              <div className="min-w-0 flex-1">
                <DraggableCard item={item} where={`${day}:${band}`} onOpen={onOpen} showAssignee={showAssignee} />
              </div>
            </li>
          ))}
        </ul>
      )}
      </DropZone>
    </section>
  );
}
