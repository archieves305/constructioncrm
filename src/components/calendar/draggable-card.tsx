"use client";

import { useDraggable } from "@dnd-kit/core";
import { canDrag } from "@/lib/calendar/move";
import { CalendarTaskCard, type CalendarTaskCardProps } from "./calendar-task-card";
import { draggableId, useCalendarDndState } from "./dnd-state";

/**
 * A calendar card that can be picked up. Whether it can is decided here, once,
 * from the same rule the server applies (`canDrag`): closed tasks, READ_ONLY
 * and other people's tasks (for own-only roles) render as plain cards. `where`
 * is the day or lane the card is drawn in — a span appears on several days
 * and dnd-kit needs each copy to have its own id.
 */
export function DraggableCard({ where, ...props }: Omit<CalendarTaskCardProps, "dragProps" | "dragging"> & { where: string }) {
  const { enabled, actor } = useCalendarDndState();
  const draggable = enabled && actor !== null && canDrag(actor, props.item);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId(props.item, where),
    data: { item: props.item },
    disabled: !draggable,
  });
  if (!draggable) return <CalendarTaskCard {...props} />;
  return <CalendarTaskCard {...props} dragging={isDragging} dragProps={{ ref: setNodeRef, ...attributes, ...listeners }} />;
}
