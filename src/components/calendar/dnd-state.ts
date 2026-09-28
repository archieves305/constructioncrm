"use client";

import { createContext, useContext } from "react";
import type { MoveActor } from "@/lib/calendar/move";
import type { CalendarItem, CalendarPerson } from "@/lib/calendar/types";

/**
 * What every drop zone and draggable card needs to know about the drag in
 * progress: who is dragging, whether they dispatch, and which item is in the
 * air (so a zone can refuse it visibly). Provided by `CalendarDnd`.
 */
export type CalendarDndState = {
  enabled: boolean;
  actor: MoveActor | null;
  dispatch: boolean;
  people: readonly CalendarPerson[];
  activeItem: CalendarItem | null;
};

export const DISABLED_DND: CalendarDndState = { enabled: false, actor: null, dispatch: false, people: [], activeItem: null };

export const CalendarDndContext = createContext<CalendarDndState>(DISABLED_DND);

export function useCalendarDndState(): CalendarDndState {
  return useContext(CalendarDndContext);
}

/** A card's dnd id: a span shows on several days, so the day disambiguates. */
export function draggableId(item: CalendarItem, where: string): string {
  return `${item.id}@${where}`;
}
