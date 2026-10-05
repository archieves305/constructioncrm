"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Hammer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { useInvalidateWorkflow } from "@/components/workflows/use-workflow";
import { fetchJson } from "@/lib/fetch-json";
import { JobPersonnelScopePanel } from "./job-personnel-scope-panel";

export type CrewAssignment = {
  id: string;
  crew: { name: string; trades: string[] };
  installDate: string | null;
  /** The open get-ready task the install date raised, if any. */
  installTask?: { id: string; dueAt: string | null; assignedTo: { firstName: string; lastName: string } | null } | null;
};

/** An install date is a day, not an instant: read it off the stored value's UTC date. */
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const longDay = (day: string) => format(parseISO(day), "EEE, MMM d");

/**
 * Assign a crew with an install date, move or clear the date, take a crew
 * off. An install date puts the day on the calendar and raises a get-ready
 * task for the job's superintendent (else its project manager), due the
 * working day before.
 */
export function CrewsPanel({
  jobId,
  crewAssignments,
  targetStartDate = null,
  canSetStart = false,
}: {
  jobId: string;
  crewAssignments: CrewAssignment[];
  targetStartDate?: string | null;
  /** The viewer may set the job's start date (offered when the job has none). */
  canSetStart?: boolean;
}) {
  const invalidate = useInvalidateWorkflow({ kind: "job", id: jobId });
  const [assignCrewId, setAssignCrewId] = useState("");
  const [assignInstallDate, setAssignInstallDate] = useState("");
  const [removing, setRemoving] = useState<CrewAssignment | null>(null);

  const { data: crews = [] } = useQuery<{ id: string; name: string; trades: string[] }[]>({
    queryKey: ["crews", "active"],
    queryFn: () => fetchJson("/api/crews?activeOnly=true"),
  });

  const useAsStart = useMutation({
    mutationFn: (day: string) =>
      fetchJson(`/api/jobs/${jobId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetStartDate: day }) }),
    onSuccess: (_d, day) => {
      invalidate([["calendar"]]);
      toast.success(`Job start date set to ${format(parseISO(day), "MMM d, yyyy")}`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not set the start date"),
  });

  /** After an install date is saved: say so, and offer it as the start date of a job that has none. */
  const saved = (message: string, day: string | null) => {
    invalidate([["calendar"], ["crews"]]);
    const offer = day && !targetStartDate && canSetStart;
    toast.success(message, offer ? { action: { label: "Use as the job's start date", onClick: () => useAsStart.mutate(day) }, duration: 10_000 } : undefined);
  };

  const assignCrew = useMutation({
    mutationFn: (data: { crewId: string; installDate: string }) =>
      fetchJson(`/api/jobs/${jobId}/crews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewId: data.crewId, installDate: data.installDate || null }),
      }),
    onSuccess: (_d, data) => {
      setAssignCrewId("");
      setAssignInstallDate("");
      saved(data.installDate ? `Crew assigned — installs ${longDay(data.installDate)}` : "Crew assigned", data.installDate || null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeCrew = useMutation({
    mutationFn: (assignmentId: string) => fetchJson(`/api/jobs/${jobId}/crews/${assignmentId}`, { method: "DELETE" }),
    onSuccess: () => {
      setRemoving(null);
      invalidate([["calendar"], ["crews"]]);
      toast.success("Crew taken off the job");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-2">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-4">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-[11px]">Crew</Label>
            <Select value={assignCrewId || "__none"} onValueChange={(v: string | null) => setAssignCrewId(!v || v === "__none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a crew">{(v: string) => (!v || v === "__none" ? "Select a crew" : crews.find((c) => c.id === v)?.name || "Select a crew")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {crews.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.trades?.length ? ` — ${c.trades.join(", ")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Install date (optional)</Label>
            <Input type="date" value={assignInstallDate} onChange={(e) => setAssignInstallDate(e.target.value)} />
          </div>
          <Button size="sm" disabled={!assignCrewId || assignCrew.isPending} onClick={() => assignCrew.mutate({ crewId: assignCrewId, installDate: assignInstallDate })}>
            Assign crew
          </Button>
          <p className="basis-full text-[11px] text-muted-foreground">
            An install date goes on the calendar and raises a get-ready task for the job&apos;s superintendent (else its project manager), due the working day before.
          </p>
        </CardContent>
      </Card>
      {crewAssignments.map((ca) => (
        <CrewRow key={`${ca.id}:${dayOf(ca.installDate)}`} jobId={jobId} assignment={ca} onSaved={saved} onRemove={() => setRemoving(ca)} />
      ))}
      {crewAssignments.length === 0 && <EmptyState icon={Hammer} title="No crews assigned" description="Pick a crew above; field mode reads from this." />}
      <JobPersonnelScopePanel jobId={jobId} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title={`Take ${removing?.crew.name ?? "this crew"} off the job?`}
        description={removing?.installDate ? "Its install date comes off the calendar and its get-ready task is closed." : "The crew is removed from this job."}
        tone="danger"
        confirmLabel="Remove crew"
        pending={removeCrew.isPending}
        onConfirm={() => { if (removing) removeCrew.mutate(removing.id); }}
      />
    </div>
  );
}

function CrewRow({
  jobId,
  assignment,
  onSaved,
  onRemove,
}: {
  jobId: string;
  assignment: CrewAssignment;
  onSaved: (message: string, day: string | null) => void;
  onRemove: () => void;
}) {
  const current = dayOf(assignment.installDate);
  const [draft, setDraft] = useState(current);

  const save = useMutation({
    mutationFn: (day: string) =>
      fetchJson(`/api/jobs/${jobId}/crews/${assignment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installDate: day || null }),
      }),
    onSuccess: (_d, day) => onSaved(day ? `${assignment.crew.name} installs ${longDay(day)}` : "Install date cleared", day || null),
    onError: (e: Error) => toast.error(e.message),
  });

  const task = assignment.installTask;
  const owner = task?.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}`.trim() : null;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 px-4">
        <div className="min-w-0">
          <span className="text-sm font-medium">{assignment.crew.name}</span>
          <Badge variant="outline" className="text-[10px] ml-2">{assignment.crew.trades?.join(", ") || "—"}</Badge>
          {task && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Get-ready task: {owner ?? "unassigned"}
              {task.dueAt ? `, due ${longDay(dayOf(task.dueAt))}` : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label={`Install date for ${assignment.crew.name}`}
            className="h-8 w-[150px] text-xs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {draft !== current && (
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(draft)}>
              {draft ? "Save" : "Clear"}
            </Button>
          )}
          <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={`Remove ${assignment.crew.name}`} onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
