"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Skeleton } from "@/components/ui/skeleton";
import { KanbanCard } from "./kanban-card";
import { KanbanColumn } from "./kanban-column";
import { EmptyColumn } from "./kanban-empty";
import { columnKeyboardCoordinates } from "./keyboard-coordinates";
import { useCollapsedColumns } from "./use-collapsed-columns";
import type { KanbanBoardProps } from "./types";

/**
 * One board for jobs, leads and tasks. Each caller supplies its columns, its
 * items, a card renderer and an `onMove`; the board owns sensors, collision,
 * the drag ghost, collapsing and the empty state.
 *
 * Mouse + Touch sensors instead of a single Pointer sensor: one distance
 * constraint fights horizontal touch-scrolling on a phone. Keyboard drags
 * hop columns (see keyboard-coordinates.ts).
 */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) return within;
  const rects = rectIntersection(args);
  return rects.length > 0 ? rects : closestCenter(args);
};

export function KanbanBoard<T extends { id: string }>({
  boardId,
  columns,
  items,
  getColumnId,
  renderCard,
  onMove,
  onOpen,
  canMove,
  dragHandle = false,
  columnWidth = 288,
  heightClassName = "h-[calc(100dvh-11rem)]",
  emptyLabel,
  isLoading = false,
}: KanbanBoardProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { collapsed, toggle } = useCollapsedColumns(
    boardId,
    columns.filter((c) => c.defaultCollapsed).map((c) => c.id),
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates }),
  );

  const byColumn = useMemo(() => {
    const m = new Map<string, T[]>();
    for (const c of columns) m.set(c.id, []);
    for (const it of items) {
      const col = getColumnId(it);
      if (!m.has(col)) m.set(col, []);
      m.get(col)!.push(it);
    }
    return m;
  }, [columns, items, getColumnId]);

  const active = activeId ? items.find((i) => i.id === activeId) ?? null : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active: a, over } = e;
    if (!over) return;
    const item = items.find((i) => i.id === a.id);
    if (!item) return;
    const from = getColumnId(item);
    const to = String(over.id);
    if (from === to) return;
    if (canMove && !canMove(item, to)) return;
    onMove(item.id, to, from);
  }

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} style={{ width: columnWidth }} className={`shrink-0 rounded-xl ${heightClassName}`} />
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex snap-x gap-3 overflow-x-auto pb-3 scroll-pl-4">
        {columns.map((col) => {
          const colItems = byColumn.get(col.id) ?? [];
          return (
            <KanbanColumn
              key={col.id}
              column={col}
              count={colItems.length}
              collapsed={collapsed.has(col.id)}
              onToggle={() => toggle(col.id)}
              width={columnWidth}
              heightClassName={heightClassName}
            >
              {colItems.length === 0 ? (
                <EmptyColumn label={emptyLabel} />
              ) : (
                colItems.map((it) => (
                  <KanbanCard key={it.id} id={it.id} dragHandle={dragHandle} onOpen={onOpen ? () => onOpen(it) : undefined}>
                    {renderCard(it, { dragging: it.id === activeId, overlay: false })}
                  </KanbanCard>
                ))
              )}
            </KanbanColumn>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div
            style={{ width: columnWidth - 16 }}
            className="rotate-1 scale-[1.02] cursor-grabbing rounded-lg bg-white p-3 text-sm shadow-xl ring-2 ring-brand/40"
          >
            {renderCard(active, { dragging: true, overlay: true })}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
