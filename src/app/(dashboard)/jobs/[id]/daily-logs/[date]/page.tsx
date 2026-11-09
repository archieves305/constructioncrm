"use client";

import { use, useState } from "react";
import { Breadcrumb } from "@/components/shared/breadcrumb";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { QueryState } from "@/components/shared/query-state";
import { EmptyState } from "@/components/shared/empty-state";
import { fetchJson } from "@/lib/fetch-json";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/session-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  CheckCircle2,
  ClipboardList,
  FileDown,
  Pencil,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { formatMinutes } from "@/components/field/touch-time-field";
import type { ServerLog } from "@/hooks/use-labor-sheet";
import { EntityTaskPanel } from "@/components/tasks/entity-task-panel";
import { useConfirm } from "@/components/shared/confirm-provider";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-surface-muted text-fg-secondary" },
  SUBMITTED: { label: "Submitted", className: "bg-tone-warning-soft text-tone-warning-fg" },
  APPROVED: { label: "Approved", className: "bg-tone-success-soft text-tone-success-fg" },
};

const NARRATIVE_LABELS: [string, string][] = [
  ["workPerformed", "Work performed"],
  ["areasWorked", "Areas worked"],
  ["materialsDelivered", "Materials delivered"],
  ["equipmentUsed", "Equipment used"],
  ["subcontractorsOnsite", "Subcontractors onsite"],
  ["inspectionsNotes", "Inspections"],
  ["delays", "Delays"],
  ["safetyIssues", "Safety"],
  ["changeOrderItems", "Change-order items observed"],
  ["ownerInstructions", "Owner / client instructions"],
  ["officeFollowUps", "Office follow-ups"],
  ["tomorrowPlan", "Plan for tomorrow"],
  ["notes", "General notes"],
];

export default function DailyLogReviewPage({
  params,
}: {
  params: Promise<{ id: string; date: string }>;
}) {
  const confirmAction = useConfirm();
  const { id: jobId, date } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const logQuery = useQuery<ServerLog & {
    returnNote: string | null;
    submittedAt: string | null;
    approvedAt: string | null;
    manager: { firstName: string; lastName: string } | null;
    submittedBy: { firstName: string; lastName: string } | null;
    approvedBy: { firstName: string; lastName: string } | null;
  }>({
    queryKey: ["daily-log", jobId, date],
    queryFn: () => fetchJson(`/api/jobs/${jobId}/daily-logs/${date}`),
  });
  const log = logQuery.data;

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnNote, setReturnNote] = useState("");

  const deleteLog = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/daily-logs/${date}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-logs", jobId] });
      qc.invalidateQueries({ queryKey: ["field-logs"] });
      toast.success("Daily log deleted");
      router.push(`/jobs/${jobId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const transition = useMutation({
    mutationFn: async ({ action, body }: { action: string; body?: unknown }) => {
      const res = await fetch(`/api/jobs/${jobId}/daily-logs/${date}/${action}`, {
        method: "POST",
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["daily-log", jobId, date] });
      qc.invalidateQueries({ queryKey: ["daily-logs", jobId] });
      qc.invalidateQueries({ queryKey: ["field-logs"] });
      setReturnOpen(false);
      setReturnNote("");
      toast.success(
        vars.action === "approve"
          ? "Log approved"
          : vars.action === "return"
            ? "Returned to crew lead"
            : "Log reopened",
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!log) {
    const back = { href: `/jobs/${jobId}?tab=field&sub=daily-logs`, label: "The job's daily logs" };
    return (
      <div className="p-6">
        <QueryState
          query={logQuery}
          noun="daily log"
          back={back}
          loading={<ListSkeleton rows={5} />}
          notFound={
            <EmptyState
              icon={ClipboardList}
              title="No daily log for this day"
              description="Nobody has started a log for this job on this date."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" render={<Link href={`/field/jobs/${jobId}/daily/${date}`} />} nativeButton={false}>Start the log for this day</Button>
                  <Button size="sm" variant="outline" render={<Link href={back.href} />} nativeButton={false}>{back.label}</Button>
                </div>
              }
            />
          }
        />
      </div>
    );
  }

  const record = log as unknown as Record<string, string | number | null>;
  const narrativeSections = NARRATIVE_LABELS.filter(
    ([key]) => typeof record[key] === "string" && (record[key] as string).trim(),
  );
  const weatherText = [
    record.weatherSummary,
    record.weatherTempHighF != null && record.weatherTempLowF != null
      ? `${record.weatherTempLowF}–${record.weatherTempHighF}°F`
      : null,
    record.weatherWindMph != null ? `wind ${record.weatherWindMph} mph` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const badge = STATUS_BADGE[log.status];
  const canModerate = role === "ADMIN" || role === "MANAGER";
  // Mirrors canAmendApprovedLog — correct an approved day in place.
  const canAmendApproved = role === "ADMIN" || role === "OFFICE_STAFF";
  const present = log.entries.filter((e) => !e.isAbsent);
  const hasCost = present.some((e) => e.totalCost !== undefined);

  return (
    <div className="space-y-6 p-6">
      <Breadcrumb items={[{ label: "Jobs", href: "/jobs" }, { label: "Job", href: `/jobs/${jobId}?tab=field&sub=daily-logs` }, { label: "Daily log" }]} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">
          Daily Log — {format(new Date(`${date}T12:00:00`), "EEEE, MMM d, yyyy")}
        </h1>
        <Badge className={badge.className}>{badge.label}</Badge>
        <div className="flex-1" />
        <a
          href={`/api/jobs/${jobId}/daily-logs/${date}/pdf`}
          target="_blank"
          rel="noreferrer"
        >
          <Button variant="outline">
            <FileDown className="mr-1 h-4 w-4" /> PDF
          </Button>
        </a>
        {canModerate && log.status === "SUBMITTED" && (
          <>
            <Button
              variant="outline"
              onClick={() => setReturnOpen(true)}
              disabled={transition.isPending}
            >
              <Undo2 className="mr-1 h-4 w-4" /> Return to draft
            </Button>
            <Button
              onClick={async () => {
                // Force a conscious look at the crew count — a day submitted
                // with fewer workers than expected is the main thing to catch.
                if (
                  await confirmAction(
                    `Approve this day — ${present.length} worker${present.length === 1 ? "" : "s"}, ${log.totals.totalHours}h total?`,
                  )
                ) {
                  transition.mutate({ action: "approve" });
                }
              }}
              disabled={transition.isPending}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
            </Button>
          </>
        )}
        {canAmendApproved && log.status === "APPROVED" && (
          // This page is read-only; the editor lives in field mode, which
          // admin/accounting can reach.
          <Link href={`/field/jobs/${jobId}/daily/${date}`}>
            <Button variant="outline">
              <Pencil className="mr-1 h-4 w-4" /> Edit approved day
            </Button>
          </Link>
        )}
        {role === "ADMIN" && log.status === "APPROVED" && (
          <Button
            variant="outline"
            onClick={async () => {
              if (await confirmAction({ title: "Reopen this approved log?", description: "Its hours become editable again until it is approved a second time.", confirmLabel: "Reopen", tone: "warning" })) {
                transition.mutate({ action: "reopen" });
              }
            }}
            disabled={transition.isPending}
          >
            <RotateCcw className="mr-1 h-4 w-4" /> Reopen
          </Button>
        )}
        {(log.status === "DRAFT" || role === "ADMIN") && (
          <Button
            variant="outline"
            onClick={async () => {
              if (
                await confirmAction(
                  `Delete this daily log? Crew hours, notes, and the day's report will be removed.${log.status !== "DRAFT" ? " This log was already " + log.status.toLowerCase() + "." : ""}`,
                )
              ) {
                deleteLog.mutate();
              }
            }}
            disabled={deleteLog.isPending}
          >
            <Trash2 className="mr-1 h-4 w-4 text-tone-danger-fg" /> Delete
          </Button>
        )}
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          {present.length} worker{present.length === 1 ? "" : "s"} ·{" "}
          {log.totals.totalHours}h
        </span>
        <span>
          Last edited {format(new Date(log.updatedAt), "MMM d, h:mm a")}
        </span>
        {weatherText && <span>Weather: {weatherText}</span>}
        {log.manager && (
          <span>
            Crew lead: {log.manager.firstName} {log.manager.lastName}
          </span>
        )}
        {log.submittedAt && log.submittedBy && (
          <span>
            Submitted {format(new Date(log.submittedAt), "MMM d, h:mm a")} by{" "}
            {log.submittedBy.firstName} {log.submittedBy.lastName}
          </span>
        )}
        {log.approvedAt && log.approvedBy && (
          <span>
            Approved {format(new Date(log.approvedAt), "MMM d, h:mm a")} by{" "}
            {log.approvedBy.firstName} {log.approvedBy.lastName}
          </span>
        )}
      </div>

      {log.returnNote && log.status === "DRAFT" && (
        <div className="rounded-md border border-tone-danger-line bg-tone-danger-soft p-3 text-sm text-tone-danger-fg">
          <span className="font-semibold">Return note:</span> {log.returnNote}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Crew — {log.totals.workersOnsite} onsite · {log.totals.totalHours}h
            {log.totals.otHours > 0 && ` (${log.totals.otHours}h OT)`}
            {log.totals.totalCost != null &&
              ` · $${log.totals.totalCost.toLocaleString()}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {log.entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">No workers logged.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    <TableHead>Trade</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead className="text-right">Break</TableHead>
                    <TableHead className="text-right">Reg</TableHead>
                    <TableHead className="text-right">OT</TableHead>
                    {hasCost && <TableHead className="text-right">Rate</TableHead>}
                    {hasCost && <TableHead className="text-right">Cost</TableHead>}
                    <TableHead>Flags / notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {log.entries.map((e) => (
                    <TableRow key={e.id} className={e.isAbsent ? "opacity-60" : ""}>
                      <TableCell className="font-medium">
                        {e.personnel
                          ? `${e.personnel.lastName}, ${e.personnel.firstName}`
                          : e.personnelId}
                      </TableCell>
                      <TableCell>{e.trade ?? "—"}</TableCell>
                      <TableCell>
                        {e.isAbsent ? "Absent" : formatMinutes(e.startMinutes)}
                      </TableCell>
                      <TableCell>
                        {e.isAbsent ? "—" : formatMinutes(e.endMinutes)}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.isAbsent ? "—" : `${e.breakMinutes}m`}
                      </TableCell>
                      <TableCell className="text-right">{e.regularHours}</TableCell>
                      <TableCell className="text-right">{e.otHours}</TableCell>
                      {hasCost && (
                        <TableCell className="text-right">
                          {"regularRate" in e && e.regularRate != null
                            ? `$${e.regularRate}`
                            : "—"}
                        </TableCell>
                      )}
                      {hasCost && (
                        <TableCell className="text-right">
                          {e.totalCost != null
                            ? `$${e.totalCost.toLocaleString()}`
                            : "—"}
                        </TableCell>
                      )}
                      <TableCell className="max-w-[220px]">
                        <span className="flex flex-wrap items-center gap-1">
                          {e.isLate && <Badge variant="secondary">Late</Badge>}
                          {e.leftEarly && <Badge variant="secondary">Left early</Badge>}
                          {e.notes && (
                            <span className="text-muted-foreground truncate text-xs italic">
                              {e.notes}
                            </span>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {narrativeSections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Jobsite Report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {narrativeSections.map(([key, label]) => (
              <div key={key}>
                <div className="text-muted-foreground text-xs font-semibold uppercase">
                  {label}
                </div>
                <p className="text-sm whitespace-pre-line">{record[key] as string}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Issues the crew flagged land here as tasks (via field issues), and
          the office can raise its own follow-ups against this day's log. */}
      <EntityTaskPanel
        context={{
          dailyLogId: log.id,
          jobId,
          label: `Daily log · ${format(new Date(`${date}T12:00:00`), "MMM d, yyyy")}`,
          href: `/jobs/${jobId}/daily-logs/${date}`,
        }}
        title="Office follow-ups"
        invalidateKeys={[["daily-log", jobId, date]]}
        emptyText="No follow-ups on this log."
      />

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return to crew lead</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={3}
            placeholder="What needs fixing? (shown to the crew lead)"
            value={returnNote}
            onChange={(e) => setReturnNote(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReturnOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!returnNote.trim() || transition.isPending}
              onClick={() =>
                transition.mutate({ action: "return", body: { note: returnNote.trim() } })
              }
            >
              Return log
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
