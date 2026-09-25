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
import { DEFAULT_COLUMN_LIMIT, nextShown, splitVisible } from "@/lib/kanban/limit";
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
  maxVisiblePerColumn = DEFAULT_COLUMN_LIMIT,
  density = "comfortable",
  resetKey = "",
  notice,
}: KanbanBoardProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Per-column "shown" counts; a changed resetKey (filters, scope) drops
  // them during render rather than in an effect.
  const [shown, setShown] = useState<{ key: string; counts: Map<string, number> }>({ key: resetKey, counts: new Map() });
  if (shown.key !== resetKey) setShown({ key: resetKey, counts: new Map() });
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
      {notice}
      <div className="flex snap-x gap-3 overflow-x-auto pb-3 scroll-pl-4">
        {columns.map((col) => {
          const colItems = byColumn.get(col.id) ?? [];
          const shownCount = shown.counts.get(col.id) ?? maxVisiblePerColumn;
          const { visible, hidden } = splitVisible(colItems, shownCount);
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
                <>
                  {visible.map((it) => (
                    <KanbanCard
                      key={it.id}
                      id={it.id}
                      dragHandle={dragHandle}
                      onOpen={onOpen ? () => onOpen(it) : undefined}
                      compact={density === "compact"}
                    >
                      {renderCard(it, { dragging: it.id === activeId, overlay: false, density })}
                    </KanbanCard>
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setShown((prev) => {
                          const counts = new Map(prev.counts);
                          counts.set(col.id, nextShown(shownCount, maxVisiblePerColumn));
                          return { key: prev.key, counts };
                        })
                      }
                      className="w-full rounded-md border border-dashed border-gray-300 bg-white/60 px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-white hover:text-gray-900"
                    >
                      Show {Math.min(maxVisiblePerColumn, hidden)} more · {hidden} hidden
                    </button>
                  )}
                </>
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
            {renderCard(active, { dragging: true, overlay: true, density })}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
