"use client";

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { taskKeys } from "@/components/tasks/use-tasks";
import type { TaskListItem } from "@/components/tasks/types";
import type { DropTarget } from "@/lib/calendar/drop-target";
import { applyMove, describeMove, type MovePatch } from "@/lib/calendar/move";
import type { CalendarItem, CalendarPerson } from "@/lib/calendar/types";
import { fetchJson } from "@/lib/fetch-json";
import { calendarKeys } from "./use-calendar";

/**
 * Move a card now, confirm with the server, snap back on failure.
 *
 * Not `useOptimisticMove`: that handles one query key, and a drop touches
 * every loaded calendar query — the visible range, the prefetched neighbours,
 * the Unscheduled rail. Each is snapshotted, repainted with the same pure
 * `applyMove` the tests cover, and restored together if the PATCH fails.
 */

export type MoveVars = { item: CalendarItem; target: DropTarget; patch: MovePatch };

type ItemList = { items: CalendarItem[] };

function isUnscheduledKey(key: QueryKey): boolean {
  return key[1] === "unscheduled";
}

/** The list after the move: replaced in place, dropped if it left this list, added if it joined it. */
export function applyMoveToList(list: CalendarItem[], next: CalendarItem, unscheduledList: boolean): CalendarItem[] {
  const belongs = unscheduledList ? next.dueAt === null : next.dueAt !== null;
  const without = list.filter((i) => i.id !== next.id);
  if (!belongs) return without;
  const idx = list.findIndex((i) => i.id === next.id);
  if (idx === -1) return [...list, next];
  return list.map((i) => (i.id === next.id ? next : i));
}

export function useMoveTask(people: readonly CalendarPerson[]) {
  const qc = useQueryClient();
  return useMutation<TaskListItem, Error, MoveVars, { snapshots: [QueryKey, ItemList | undefined][] }>({
    mutationFn: ({ item, patch }) =>
      fetchJson<TaskListItem>(`/api/tasks/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onMutate: async ({ item, patch }) => {
      await qc.cancelQueries({ queryKey: calendarKeys.all });
      const snapshots = qc.getQueriesData<ItemList>({ queryKey: calendarKeys.all });
      const next = applyMove(item, patch, people);
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<ItemList>(key, { ...data, items: applyMoveToList(data.items, next, isUnscheduledKey(key)) });
      }
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
      toast.error(err.message || "Couldn't move that task");
    },
    onSuccess: (_task, { item, target }) => {
      toast.success(describeMove(item, target, people));
    },
    onSettled: (_data, _err, { item }) => {
      qc.invalidateQueries({ queryKey: calendarKeys.all });
      qc.invalidateQueries({ queryKey: taskKeys.all });
      qc.invalidateQueries({ queryKey: taskKeys.summary });
      qc.invalidateQueries({ queryKey: taskKeys.detail(item.id) });
      qc.invalidateQueries({ queryKey: ["field-today"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
