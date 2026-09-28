"use client";

import { useDroppable } from "@dnd-kit/core";
import { dropId, type DropTarget } from "@/lib/calendar/drop-target";
import { canMove } from "@/lib/calendar/move";
import { cn } from "@/lib/utils";
import { useCalendarDndState } from "./dnd-state";

/**
 * Somewhere a card can land: a day column, a Day-view band, a Month cell, a
 * People cell, the Unscheduled rail. While a card is in the air the zone
 * knows whether it may take it (the same `canMove` the drop handler runs) and
 * says so: a tint when it can, hatching + `aria-disabled` when it cannot.
 */
export function DropZone({
  target,
  className,
  children,
  label,
}: {
  target: DropTarget;
  className?: string;
  children: React.ReactNode;
  /** Announced as the zone's name; the cell's own text is usually enough. */
  label?: string;
}) {
  const { enabled, actor, dispatch, activeItem } = useCalendarDndState();
  const refused = Boolean(activeItem && actor && !canMove(actor, activeItem, target, { dispatch }));
  const { setNodeRef, isOver } = useDroppable({ id: dropId(target), disabled: !enabled || refused, data: { target } });
  const active = enabled && activeItem !== null;
  return (
    <div
      ref={setNodeRef}
      aria-label={label}
      aria-disabled={active && refused ? true : undefined}
      data-drop-over={isOver && !refused ? "" : undefined}
      className={cn(
        "rounded-md transition-colors",
        active && !refused && "outline-1 outline-dashed outline-gray-300",
        isOver && !refused && "bg-brand/5 outline-2 outline-brand/60",
        active && refused && "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgb(0_0_0/0.05)_6px,rgb(0_0_0/0.05)_12px)] opacity-70",
        className,
      )}
    >
      {children}
    </div>
  );
}
