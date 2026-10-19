"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { fetchJson } from "@/lib/fetch-json";
import type { UserOption } from "@/components/tasks/types";

type Action = { action: "reschedule"; dueAt: string } | { action: "assign"; assignedUserId: string } | { action: "close"; reason: string };

/**
 * The backlog clean-up, for a manager on the Overdue filter: move every
 * overdue task shown to one day, give them to one person, or close them with
 * a reason. The filters above decide which tasks — narrow by person or job
 * first. Each task goes through the ordinary update (its timeline, its rules);
 * one the rules refuse is named in the result.
 */
export function BulkOverduePanel({ taskIds, users }: { taskIds: string[]; users: UserOption[] }) {
  const qc = useQueryClient();
  const [day, setDay] = useState("");
  const [person, setPerson] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<Action | null>(null);

  const run = useMutation({
    mutationFn: (a: Action) => fetchJson<{ done: number; refused: { id: string; reason: string }[] }>("/api/tasks/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...a, ids: taskIds }) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["attention"] });
      if (r.refused.length) toast.warning(`${r.done} changed; ${r.refused.length} refused — ${r.refused[0].reason}${r.refused.length > 1 ? " (and others)" : ""}`, { duration: 12_000 });
      else toast.success(`${r.done} task${r.done === 1 ? "" : "s"} changed`);
      setPending(null);
      setReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (taskIds.length === 0) return null;
  const n = `${taskIds.length} overdue task${taskIds.length === 1 ? "" : "s"}`;
  const what = (a: Action) =>
    a.action === "reschedule" ? `Move ${n} to ${a.dueAt}?` : a.action === "assign" ? `Give ${n} to ${users.find((u) => u.id === a.assignedUserId)?.firstName ?? "this person"}?` : `Close ${n}?`;

  return (
    <Card className="mb-3 border-tone-warning-fg/30">
      <CardContent className="space-y-3 pt-4">
        <p className="text-sm">
          <span className="font-medium">Clean up the {n} shown.</span>{" "}
          <span className="text-muted-foreground">Narrow by person or job above first; every change is recorded on each task.</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-[160px]" aria-label="Move to day" />
          <Button size="sm" variant="outline" disabled={!day || run.isPending} onClick={() => setPending({ action: "reschedule", dueAt: day })}>
            Move all to this day
          </Button>
          <AssigneePicker value={person} onChange={setPerson} users={users} className="w-[180px]" />
          <Button size="sm" variant="outline" disabled={!person || run.isPending} onClick={() => person && setPending({ action: "assign", assignedUserId: person })}>
            Give all to this person
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why they no longer need doing" className="min-w-[240px] flex-1" />
          <Button size="sm" variant="outline" disabled={reason.trim().length < 3 || run.isPending} onClick={() => setPending({ action: "close", reason: reason.trim() })}>
            Close all with this reason
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? what(pending) : ""}
        description={pending?.action === "close" ? `Each is closed with "${pending.reason}". A workflow step is skipped with that reason; a blocking step only by an admin or manager.` : "Each task keeps its history; the people affected are told as usual."}
        confirmLabel="Go ahead"
        onConfirm={() => { if (pending) run.mutate(pending); }}
      />
    </Card>
  );
}
