"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight, CheckSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useSession } from "@/lib/auth/session-client";
import { bucketByDue } from "@/lib/tasks/summary";
import { cn } from "@/lib/utils";
import { TaskDetailSheet } from "./task-detail-sheet";
import { TaskEntityChip } from "./task-entity-chip";
import { PRIORITY_DOT_CLASS } from "./task-colors";
import type { TaskListItem } from "./types";
import { useAssignableUsers, useTasks, useUpdateTask } from "./use-tasks";

const LIMIT = 5;

/** Dashboard card: what is on my plate, overdue first. */
export function MyTasksWidget({ className }: { className?: string }) {
  const { data: session } = useSession();
  const { data: tasks = [], isLoading } = useTasks({ assignedUserId: "me" });
  const { data: users = [] } = useAssignableUsers();
  const update = useUpdateTask();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const buckets = useMemo(() => bucketByDue(tasks), [tasks]);
  const sections: { key: keyof typeof buckets; title: string; tone: string }[] = [
    { key: "overdue", title: "Overdue", tone: "text-red-600" },
    { key: "today", title: "Due today", tone: "text-amber-700" },
    { key: "upcoming", title: "Coming up", tone: "text-gray-700" },
    { key: "noDate", title: "No date", tone: "text-gray-500" },
  ];
  const total = tasks.length;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckSquare className="size-4 text-muted-foreground" />
          My tasks
          {total > 0 && <span className="text-sm font-normal text-muted-foreground">{total} open</span>}
        </CardTitle>
        <Link
          href="/tasks?assignedUserId=me"
          className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
        >
          View all <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : total === 0 ? (
          <EmptyState icon={CheckSquare} title="Nothing assigned to you" description="Enjoy it. New tasks show up here the moment someone assigns one." />
        ) : (
          sections.map((s) => {
            const rows = buckets[s.key];
            if (rows.length === 0) return null;
            return (
              <div key={s.key}>
                <div className={cn("mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", s.tone)}>
                  {s.title} <span className="font-normal text-muted-foreground">({rows.length})</span>
                </div>
                <ul className="divide-y rounded-md border">
                  {rows.slice(0, LIMIT).map((t) => (
                    <Row
                      key={t.id}
                      task={t}
                      onOpen={() => setOpenTaskId(t.id)}
                      onDone={() => update.mutate({ id: t.id, patch: { status: "COMPLETED" } })}
                    />
                  ))}
                </ul>
                {rows.length > LIMIT && (
                  <Link
                    href={s.key === "overdue" ? "/tasks?assignedUserId=me&overdue=1" : "/tasks?assignedUserId=me"}
                    className="mt-1 inline-block text-xs text-muted-foreground hover:underline"
                  >
                    +{rows.length - LIMIT} more
                  </Link>
                )}
              </div>
            );
          })
        )}
      </CardContent>
      <TaskDetailSheet
        taskId={openTaskId}
        users={users}
        currentUserId={session?.user.id ?? ""}
        isAdmin={session?.user.role === "ADMIN"}
        onClose={() => setOpenTaskId(null)}
      />
    </Card>
  );
}

function Row({ task, onOpen, onDone }: { task: TaskListItem; onOpen: () => void; onDone: () => void }) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <Checkbox aria-label="Mark complete" checked={false} onCheckedChange={(c) => c && onDone()} />
      <span className={cn("size-2 shrink-0 rounded-full", PRIORITY_DOT_CLASS[task.priority])} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline">
        {task.title}
      </button>
      <TaskEntityChip task={task} className="hidden sm:inline-flex" />
      {task.dueAt && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {format(new Date(task.dueAt), "MMM d")}
        </span>
      )}
    </li>
  );
}
