"use client";

import { useMemo } from "react";
import { jobLabel } from "@/lib/labels/job";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { ChevronRight, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { bucketByDue } from "@/lib/tasks/summary";
import { cn } from "@/lib/utils";
import { PRIORITY_BADGE_CLASS, STATUS_BADGE_CLASS, STATUS_LABEL } from "@/components/tasks/task-colors";
import { useTasks } from "@/components/tasks/use-tasks";
import type { TaskListItem } from "@/components/tasks/types";

/**
 * A crew lead's own queue, phone-first. Until now the only way to reach a
 * task in field mode was the link in an email; this is the index that was
 * missing. Rows are tall, the whole row is the tap target, and the detail
 * page does the rest.
 */
export default function FieldTasksPage() {
  const params = useSearchParams();
  const jobId = params.get("job") ?? undefined;
  const { data: tasks = [], isLoading } = useTasks({ assignedUserId: "me", jobId });

  const buckets = useMemo(() => bucketByDue(tasks), [tasks]);
  const sections: { key: keyof typeof buckets; title: string; tone: string }[] = [
    { key: "overdue", title: "Overdue", tone: "text-red-600" },
    { key: "today", title: "Due today", tone: "text-amber-700" },
    { key: "upcoming", title: "Coming up", tone: "text-gray-700" },
    { key: "noDate", title: "No due date", tone: "text-gray-500" },
  ];
  const jobFilter = jobId ? tasks.find((t) => t.job?.id === jobId)?.job : null;
  const jobLabelText = jobFilter ? jobLabel(jobFilter, { customer: false }).primary : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">My Tasks</h1>
        {jobId && (
          <Link href="/field/tasks" className="text-sm text-blue-700 hover:underline">
            {jobLabelText ? `${jobLabelText} · ` : ""}Show all
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center">
            Nothing assigned to you{jobId ? " on this job" : ""}. The office will send work here.
          </CardContent>
        </Card>
      ) : (
        sections.map((s) => {
          const rows = buckets[s.key];
          if (rows.length === 0) return null;
          return (
            <section key={s.key} className="space-y-2">
              <h2 className={cn("px-1 text-xs font-semibold uppercase tracking-wide", s.tone)}>
                {s.title} <span className="font-normal text-muted-foreground">({rows.length})</span>
              </h2>
              {rows.map((t) => (
                <TaskRow key={t.id} task={t} overdue={s.key === "overdue"} />
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function TaskRow({ task, overdue }: { task: TaskListItem; overdue: boolean }) {
  return (
    <Link href={`/field/tasks/${task.id}`} className="block">
      <Card className="active:bg-gray-50">
        <CardContent className="flex min-h-16 items-center gap-3 py-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-base font-semibold">{task.title}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge className={cn("border-0", STATUS_BADGE_CLASS[task.status])}>{STATUS_LABEL[task.status]}</Badge>
              <Badge className={cn("border-0", PRIORITY_BADGE_CLASS[task.priority])}>{task.priority}</Badge>
              {task.dueAt && (
                <span className={cn(overdue ? "font-semibold text-red-600" : "text-muted-foreground")}>
                  {overdue ? "Overdue · " : "Due "}
                  {format(new Date(task.dueAt), "EEE, MMM d")}
                </span>
              )}
              {task.job && !task.violationCase && (
                <span className="truncate text-muted-foreground" title={task.job.jobNumber}>{jobLabel(task.job, { customer: false }).primary}</span>
              )}
              {task.violationCase && <span className="font-mono text-muted-foreground">{task.violationCase.caseNumber}</span>}
              {(task._count?.events ?? 0) > 0 && (
                <span className="flex items-center gap-0.5 text-muted-foreground">
                  <MessageSquare className="h-3 w-3" />
                  {task._count!.events}
                </span>
              )}
            </div>
            {task.status === "BLOCKED" && task.blockedReason && (
              <div className="truncate text-xs text-amber-700">Blocked — {task.blockedReason}</div>
            )}
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
