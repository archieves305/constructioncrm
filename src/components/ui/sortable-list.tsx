"use client";

import { useId, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A reorderable vertical list. Mouse and touch drag via the handle, keyboard
 * drag (space, arrows, space) via the handle, and plain Move up / Move down
 * buttons for anyone who would rather not drag. Every move is announced to
 * a live region.
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  label,
  disabled,
  className,
  itemClassName,
}: {
  items: T[];
  onReorder: (ids: string[]) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  label: string;
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [announce, setAnnounce] = useState("");
  const liveId = useId();
  const ids = items.map((i) => i.id);

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return;
    const next = arrayMove(ids, from, to);
    setAnnounce(`Moved to position ${to + 1} of ${items.length}`);
    onReorder(next);
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        <ul aria-label={label} className={cn("space-y-1", className)}>
          {items.map((item, i) => (
            <Row key={item.id} id={item.id} disabled={disabled} className={itemClassName} onUp={() => move(i, i - 1)} onDown={() => move(i, i + 1)} first={i === 0} last={i === items.length - 1}>
              {renderItem(item, i)}
            </Row>
          ))}
        </ul>
      </SortableContext>
      <span id={liveId} role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
    </DndContext>
  );
}

function Row({ id, disabled, className, onUp, onDown, first, last, children }: { id: string; disabled?: boolean; className?: string; onUp: () => void; onDown: () => void; first: boolean; last: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("flex items-center gap-1 rounded-md border bg-white", isDragging && "z-10 shadow-lg ring-1 ring-brand/40", className)}>
      {!disabled && (
        <button type="button" className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-gray-100 active:cursor-grabbing" aria-label="Drag to reorder" {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {!disabled && (
        <div className="flex flex-col">
          <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-gray-100 disabled:opacity-30" aria-label="Move up" disabled={first} onClick={onUp}>
            <ChevronUp className="size-3.5" />
          </button>
          <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-gray-100 disabled:opacity-30" aria-label="Move down" disabled={last} onClick={onDown}>
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}
