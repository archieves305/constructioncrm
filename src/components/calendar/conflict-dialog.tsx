"use client";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { describeConflict } from "@/lib/calendar/conflicts";
import type { DropTarget } from "@/lib/calendar/drop-target";
import { describeTarget } from "@/lib/calendar/move";
import type { CalendarItem, CalendarPerson } from "@/lib/calendar/types";

export type PendingMove = {
  item: CalendarItem;
  /** The item as it would be after the move. */
  next: CalendarItem;
  target: DropTarget;
  conflicts: CalendarItem[];
};

/**
 * "Lisette already has 'Roof tear-off' 9:00 – 12:00 PM. Schedule anyway?"
 * Warn, never block: the office knows when a double-booking is deliberate.
 */
export function ConflictDialog({
  pending,
  people,
  busy,
  onConfirm,
  onCancel,
}: {
  pending: PendingMove | null;
  people: readonly CalendarPerson[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const who = pending?.next.assignedTo ?? null;
  const n = pending?.conflicts.length ?? 0;
  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(o) => !o && onCancel()}
      tone="warning"
      title="Schedule anyway?"
      description={
        pending
          ? `${who ? who.firstName : "This person"} would be double-booked ${describeTarget(pending.target, people)} — “${pending.item.title}” overlaps ${n === 1 ? "another task" : `${n} other tasks`}.`
          : undefined
      }
      warning={
        pending ? (
          <ul className="space-y-1 text-sm">
            {pending.conflicts.map((c) => (
              <li key={c.id}>{describeConflict(c, who)}</li>
            ))}
          </ul>
        ) : undefined
      }
      confirmLabel="Schedule anyway"
      cancelLabel="Keep it where it was"
      pending={busy}
      onConfirm={onConfirm}
    />
  );
}
