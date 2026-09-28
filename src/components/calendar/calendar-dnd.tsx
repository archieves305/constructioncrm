"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { kitCollision, useKitSensors } from "@/components/kanban/sensors";
import { findConflicts } from "@/lib/calendar/conflicts";
import { parseDropId } from "@/lib/calendar/drop-target";
import { containerAt, nearestInDirection, type Direction, type Rect } from "@/lib/calendar/grid-nav";
import { applyMove, canMove, dependencyWarning, describeTarget, movePatch, type MoveActor } from "@/lib/calendar/move";
import type { CalendarItem, CalendarPerson } from "@/lib/calendar/types";
import { CalendarTaskCard } from "./calendar-task-card";
import { ConflictDialog, type PendingMove } from "./conflict-dialog";
import { CalendarDndContext, type CalendarDndState } from "./dnd-state";
import { useMoveTask } from "./use-move-task";

/**
 * One drag context around every calendar view and the Unscheduled rail, so a
 * card can travel from the rail to a People cell, or from Tuesday to Thursday,
 * in one gesture. Drop → `parseDropId` → `canMove` → `movePatch` → conflicts?
 * ask : mutate. Nothing here decides what a move means; the pure modules do.
 *
 * Keyboard: Space picks up (Enter still opens the card), arrows walk the
 * droppables by geometry, Space drops, Escape cancels — with announcements.
 */

const DIRECTIONS: Partial<Record<string, Direction>> = {
  [KeyboardCode.Right]: "right",
  [KeyboardCode.Left]: "left",
  [KeyboardCode.Down]: "down",
  [KeyboardCode.Up]: "up",
};

const gridKeyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  const dir = DIRECTIONS[event.code];
  if (!dir) return undefined;
  const { droppableRects, droppableContainers } = context;
  const containers = droppableContainers.getEnabled();
  const cands: { id: string; rect: Rect }[] = [];
  for (const c of containers) {
    const r = droppableRects.get(c.id);
    if (r) cands.push({ id: String(c.id), rect: { left: r.left, top: r.top, width: r.width, height: r.height } });
  }
  const currentId = containerAt(currentCoordinates, cands);
  const current = cands.find((c) => c.id === currentId);
  if (!current) return undefined;
  const nextId = nearestInDirection(current.rect, cands.filter((c) => c.id !== current.id), dir);
  if (!nextId) return undefined;
  const container = containers.find((c) => String(c.id) === nextId);
  const rect = container ? droppableRects.get(container.id) : undefined;
  if (!container || !rect) return undefined;
  container.node.current?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return { x: rect.left + 12, y: rect.top + 12 };
};

export function CalendarDnd({
  enabled,
  actor,
  dispatch,
  people,
  items,
  onOpen,
  children,
}: {
  enabled: boolean;
  actor: MoveActor | null;
  dispatch: boolean;
  people: readonly CalendarPerson[];
  /** Everything currently loaded (range + rail), for conflicts and announcements. */
  items: readonly CalendarItem[];
  onOpen: (id: string) => void;
  children: React.ReactNode;
}) {
  const [activeItem, setActiveItem] = useState<CalendarItem | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const move = useMoveTask(people);
  const sensors = useKitSensors(gridKeyboardCoordinates, { enterOpens: true });

  const state = useMemo<CalendarDndState>(() => ({ enabled, actor, dispatch, people, activeItem }), [enabled, actor, dispatch, people, activeItem]);

  const itemOf = useCallback((data: unknown): CalendarItem | null => {
    const d = data as { item?: CalendarItem } | undefined;
    return d?.item ?? null;
  }, []);

  function onDragStart(e: DragStartEvent) {
    setActiveItem(itemOf(e.active.data.current));
  }

  function onDragEnd(e: DragEndEvent) {
    const item = itemOf(e.active.data.current);
    setActiveItem(null);
    const target = parseDropId(e.over?.id);
    if (!item || !target || !actor || !enabled) return;
    if (!canMove(actor, item, target, { dispatch })) return;
    const patch = movePatch(item, target);
    if (!patch) return;
    const next = applyMove(item, patch, people);
    const conflicts = findConflicts(next, items);
    if (conflicts.length > 0) {
      setPending({ item, next, target, conflicts });
      return;
    }
    commit(item, target, patch);
  }

  /** Save, and say so if the step is still waiting on an earlier one (warn, never block). */
  function commit(item: CalendarItem, target: NonNullable<ReturnType<typeof parseDropId>>, patch: NonNullable<ReturnType<typeof movePatch>>) {
    move.mutate({ item, target, patch });
    const warning = target.kind === "unscheduled" ? null : dependencyWarning(item);
    if (warning) toast.warning(warning, { duration: 6000 });
  }

  function confirmPending() {
    if (!pending) return;
    const patch = movePatch(pending.item, pending.target);
    setPending(null);
    if (patch) commit(pending.item, pending.target, patch);
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const t = itemOf(active.data.current)?.title ?? "task";
      return `Picked up ${t}. Arrow keys move between days and people, Space drops, Escape cancels.`;
    },
    onDragOver: ({ active, over }) => {
      const t = itemOf(active.data.current)?.title ?? "task";
      const target = parseDropId(over?.id);
      return target ? `${t} is over ${describeTarget(target, people)}.` : `${t} is not over a day.`;
    },
    onDragEnd: ({ active, over }) => {
      const t = itemOf(active.data.current)?.title ?? "task";
      const target = parseDropId(over?.id);
      return target ? `Dropped ${t} on ${describeTarget(target, people)}.` : `Dropped ${t}. Nothing changed.`;
    },
    onDragCancel: ({ active }) => `Cancelled. ${itemOf(active.data.current)?.title ?? "The task"} stays where it was.`,
  };

  return (
    <CalendarDndContext.Provider value={state}>
      <DndContext
        sensors={sensors}
        collisionDetection={kitCollision}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveItem(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: "Press Space to pick up the task, arrow keys to move it to another day or person, Space to drop, Escape to cancel. Enter opens it." },
        }}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {activeItem ? (
            <div style={{ width: 240 }}>
              <CalendarTaskCard item={activeItem} onOpen={onOpen} overlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <ConflictDialog pending={pending} people={people} busy={move.isPending} onConfirm={confirmPending} onCancel={() => setPending(null)} />
    </CalendarDndContext.Provider>
  );
}
