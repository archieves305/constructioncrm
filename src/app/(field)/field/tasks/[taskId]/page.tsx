"use client";

import { use, useRef, useState } from "react";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import type { JobLabel, LeadLabel } from "@/components/tasks/types";
import { formatAddressLine } from "@/lib/labels/address";
import { jobLabel } from "@/lib/labels/job";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Camera, Paperclip } from "lucide-react";
import { formatTimeRange } from "@/lib/calendar/agenda";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { PRIORITY_BADGE_CLASS, STATUS_BADGE_CLASS, STATUS_LABEL } from "@/components/tasks/task-colors";
import { taskKeys } from "@/components/tasks/use-tasks";
import { useTaskFileUpload } from "@/components/workflows/use-task-file-upload";
import { FilePreviewDialog } from "@/components/files/file-preview";

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
  scheduledStart?: string | null;
  allDay?: boolean;
  blockedReason: string | null;
  /** Workflow steps carry a checklist the crew ticks from here (`#checklist`). */
  checklist?: { key: string; label: string; done: boolean }[] | null;
  job: JobLabel | null;
  lead?: LeadLabel | null;
  violationCase?: { id: string; caseNumber: string; agencyCaseNumber: string | null } | null;
  assignedTo: Person | null;
  createdBy: Person | null;
  /** Photos and documents attached to the task. */
  files?: { id: string; fileName: string; fileType: string }[];
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
  const [preview, setPreview] = useState<number | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [showBlock, setShowBlock] = useState(false);
  // Why the last "Mark done" was refused, shown where the thumb already is.
  const [refused, setRefused] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
      setRefused(null);
      toast.success("Task updated");
    },
    onError: (e: Error, body) => {
      if (body.status === "COMPLETED") setRefused(e.message);
      toast.error(e.message);
    },
  });

  const upload = useTaskFileUpload(taskId, {
    onDone: () => {
      refresh();
      setRefused(null);
    },
  });
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload.mutate(f);
    e.target.value = "";
  };

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
    return <div className="p-6"><ListSkeleton rows={3} /></div>;
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
  const checklist = task.checklist ?? [];
  const files = task.files ?? [];

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
                {task.allDay === false && task.scheduledStart
                  ? `${format(new Date(task.dueAt), "MMM d")} · ${formatTimeRange(task.scheduledStart, task.dueAt)}`
                  : `Due ${format(new Date(task.dueAt), "MMM d")}`}
              </Badge>
            )}
          </div>

          {task.job && !task.violationCase && (
            <p className="text-sm text-muted-foreground">
              {jobLabel(task.job).primary}
              {jobLabel(task.job).code && <span className="ml-2 font-mono text-xs">{jobLabel(task.job).code}</span>}
            </p>
          )}
          {task.violationCase && (
            <p className="text-sm text-muted-foreground">
              Code violation <span className="font-mono">{task.violationCase.caseNumber}</span>
              {task.lead ? ` — ${formatAddressLine(task.lead) || task.lead.fullName}` : ""}
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

          {checklist.length > 0 && (
            <section id="checklist" className="rounded-md border p-3" aria-label="Checklist">
              <h2 className="text-sm font-semibold">
                Checklist <span className="font-normal text-muted-foreground">{checklist.filter((c) => c.done).length}/{checklist.length}</span>
              </h2>
              <ul className="mt-1 divide-y">
                {checklist.map((c) => (
                  <li key={c.key}>
                    {/* The whole row is the target: a 44px label with the box inside it. */}
                    <label className="flex min-h-11 items-center gap-3 py-1 text-base">
                      <Checkbox className="size-5" checked={c.done} disabled={done || patch.isPending} onCheckedChange={(v) => patch.mutate({ checklist: [{ key: c.key, done: Boolean(v) }] })} aria-label={c.label} />
                      <span className={cn(c.done && "text-muted-foreground line-through")}>{c.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Photos and files: taken where the work is, attached to the task itself. */}
          <section className="rounded-md border p-3" aria-label="Photos and files">
            <h2 className="text-sm font-semibold">
              Photos and files <span className="font-normal text-muted-foreground">{files.length}</span>
            </h2>
            {files.length > 0 && (
              <ul className="mt-1 divide-y text-sm">
                {files.map((f, i) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => setPreview(i)} className="flex min-h-11 w-full items-center gap-2 text-left text-blue-700">
                      {f.fileType.startsWith("image/") ? <Camera className="size-4 shrink-0" /> : <Paperclip className="size-4 shrink-0" />}
                      <span className="truncate">{f.fileName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <FilePreviewDialog files={files} index={preview} onIndexChange={setPreview} />
            {!done && (
              <div className="mt-2 flex gap-2">
                <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
                <input ref={fileInput} type="file" className="hidden" onChange={pick} />
                <Button variant="outline" className="h-11 flex-1" disabled={upload.isPending} onClick={() => photoInput.current?.click()}>
                  <Camera className="size-4" /> {upload.isPending ? "Uploading…" : "Take photo"}
                </Button>
                <Button variant="outline" className="h-11 flex-1" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
                  <Paperclip className="size-4" /> Attach file
                </Button>
              </div>
            )}
          </section>

          {refused && !done && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              <strong>Not done yet:</strong> {refused}
            </p>
          )}

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
