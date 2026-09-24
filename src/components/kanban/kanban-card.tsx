"use client";

import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The draggable shell every board card sits in. Whole-card drag by default;
 * `dragHandle` moves the listeners onto a grip for cards that carry inline
 * controls. Enter opens, Space picks up (dnd-kit's keyboard sensor).
 */
export function KanbanCard({
  id,
  onOpen,
  dragHandle = false,
  children,
  className,
}: {
  id: string;
  onOpen?: () => void;
  dragHandle?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  const base = cn(
    "group/card relative rounded-lg bg-white text-sm ring-1 ring-gray-200 shadow-xs transition",
    "hover:ring-gray-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
    isDragging && "opacity-40",
    className,
  );

  if (dragHandle) {
    return (
      <div ref={setNodeRef} className={base}>
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to move"
          className="absolute left-1 top-2 z-10 cursor-grab rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <div className="pl-5">{children}</div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-roledescription="draggable card"
      onClick={onOpen}
      onKeyDown={(e) => {
        // dnd-kit's keyboard sensor is wired through `listeners`; spreading
        // them before this prop would let ours replace theirs, so chain it.
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter" && onOpen && !e.defaultPrevented) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(base, "cursor-grab p-3 active:cursor-grabbing")}
    >
      {children}
    </div>
  );
}
