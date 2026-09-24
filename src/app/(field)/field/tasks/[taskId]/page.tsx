"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { PRIORITY_BADGE_CLASS, STATUS_BADGE_CLASS, STATUS_LABEL } from "@/components/tasks/task-colors";
import { taskKeys } from "@/components/tasks/use-tasks";

/**
 * Field-mode task view.
 *
 * Exists because task emails route CREW_LEADs here: they are confined to
 * `/field`, so an office `/tasks` link would bounce them to a redirect —
 * a dead end for precisely the people most likely to open the mail on a phone
 * at a jobsite.
 *
 * Touch-first and deliberately thin: read the task, add a note, mark it done
 * or blocked. Reassignment, priority and watchers stay in the office view.
 */

type TaskStatus = "PENDING" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";

type Person = { id: string; firstName: string; lastName: string };

type FieldTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueAt: string | null;
  blockedReason: string | null;
  job: { id: string; jobNumber: string; title: string } | null;
  assignedTo: Person | null;
  createdBy: Person | null;
  events: {
    id: string;
    type: string;
    body: string | null;
    createdAt: string;
    actor: Person | null;
  }[];
};

export default function FieldTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = use(params);
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [showBlock, setShowBlock] = useState(false);

  const { data: task, isLoading, isError } = useQuery<FieldTask>({
    queryKey: ["field-task", taskId],
    queryFn: () => fetchJson(`/api/tasks/${taskId}`),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["field-task", taskId] });
    qc.invalidateQueries({ queryKey: taskKeys.all });
    qc.invalidateQueries({ queryKey: taskKeys.summary });
  }

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Update failed");
      }
      return r.json();
    },
    onSuccess: () => {
      refresh();
      setShowBlock(false);
      setBlockReason("");
      toast.success("Task updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: async (body: string) => {
      const r = await fetch(`/api/tasks/${taskId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) throw new Error("Could not post that note");
      return r.json();
    },
    onSuccess: () => {
      setNote("");
      refresh();
      toast.success("Note added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <p className="p-6 text-center text-muted-foreground">Loading…</p>;
  }
  if (isError || !task) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">This task is not available to you.</p>
        <Link href="/field/tasks" className="mt-3 inline-block text-blue-600 underline">
          Back to my tasks
        </Link>
      </div>
    );
  }

  const notes = task.events.filter((e) => e.type === "NOTE");
  const done = task.status === "COMPLETED";

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Link
        href="/field/tasks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> My Tasks
      </Link>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <h1 className={cn("text-lg font-semibold leading-snug", done && "line-through")}>
            {task.title}
          </h1>

          <div className="flex flex-wrap gap-1.5">
            <Badge className={cn("border-0", STATUS_BADGE_CLASS[task.status])}>
              {STATUS_LABEL[task.status]}
            </Badge>
            <Badge className={cn("border-0", PRIORITY_BADGE_CLASS[task.priority])}>
              {task.priority}
            </Badge>
            {task.dueAt && (
              <Badge variant="outline">
                Due {format(new Date(task.dueAt), "MMM d")}
              </Badge>
            )}
          </div>

          {task.job && (
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{task.job.jobNumber}</span> — {task.job.title}
            </p>
          )}

          {task.description && (
            <p className="whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-gray-700">
              {task.description}
            </p>
          )}

          {task.status === "BLOCKED" && task.blockedReason && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Blocked:</strong> {task.blockedReason}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Raised by {task.createdBy ? `${task.createdBy.firstName} ${task.createdBy.lastName}` : "—"}
          </p>

          {/* Big touch targets: these get tapped with gloves on. */}
          <div className="flex flex-wrap gap-2 pt-1">
            {!done && (
              <>
                {task.status !== "IN_PROGRESS" && (
                  <Button
                    variant="outline"
                    className="h-11 flex-1"
                    disabled={patch.isPending}
                    onClick={() => patch.mutate({ status: "IN_PROGRESS" })}
                  >
                    Start
                  </Button>
                )}
                <Button
                  className="h-11 flex-1"
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ status: "COMPLETED" })}
                >
                  Mark done
                </Button>
                {task.status !== "BLOCKED" && (
                  <Button
                    variant="outline"
                    className="h-11 flex-1 border-amber-300 text-amber-800"
                    onClick={() => setShowBlock((s) => !s)}
                  >
                    Blocked
                  </Button>
                )}
              </>
            )}
            {done && (
              <Button
                variant="outline"
                className="h-11"
                disabled={patch.isPending}
                onClick={() => patch.mutate({ status: "IN_PROGRESS" })}
              >
                Reopen
              </Button>
            )}
          </div>

          {showBlock && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <label className="text-xs font-medium text-amber-900">
                What is it waiting on?
              </label>
              <Textarea
                autoFocus
                rows={2}
                className="mt-1 bg-white"
                placeholder="e.g. Waiting on the shingle delivery"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
              />
              <Button
                className="mt-2 h-10 w-full"
                disabled={!blockReason.trim() || patch.isPending}
                onClick={() =>
                  patch.mutate({ status: "BLOCKED", blockedReason: blockReason.trim() })
                }
              >
                Mark blocked
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <h2 className="text-sm font-semibold">Notes</h2>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-md border p-3">
                  <div className="mb-1 text-xs text-muted-foreground">
                    {n.actor ? `${n.actor.firstName} ${n.actor.lastName}` : "Someone"} ·{" "}
                    {format(new Date(n.createdAt), "MMM d, h:mm a")}
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                </li>
              ))}
            </ul>
          )}

          <Textarea
            rows={3}
            placeholder="Add a note for the office…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            className="h-11 w-full"
            disabled={!note.trim() || addNote.isPending}
            onClick={() => addNote.mutate(note.trim())}
          >
            {addNote.isPending ? "Posting…" : "Post note"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
