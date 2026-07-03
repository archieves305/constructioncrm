"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
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
import { ArrowLeft, CheckCircle2, RotateCcw, Undo2 } from "lucide-react";
import { formatMinutes } from "@/components/field/touch-time-field";
import type { ServerLog } from "@/hooks/use-labor-sheet";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  SUBMITTED: { label: "Submitted", className: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved", className: "bg-green-100 text-green-800" },
};

export default function DailyLogReviewPage({
  params,
}: {
  params: Promise<{ id: string; date: string }>;
}) {
  const { id: jobId, date } = use(params);
  const qc = useQueryClient();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const { data: log, isLoading } = useQuery<ServerLog & {
    returnNote: string | null;
    submittedAt: string | null;
    approvedAt: string | null;
    manager: { firstName: string; lastName: string } | null;
    submittedBy: { firstName: string; lastName: string } | null;
    approvedBy: { firstName: string; lastName: string } | null;
  }>({
    queryKey: ["daily-log", jobId, date],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/daily-logs/${date}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnNote, setReturnNote] = useState("");

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

  if (isLoading) return <div className="text-muted-foreground p-6">Loading…</div>;
  if (!log) return <div className="text-muted-foreground p-6">Log not found.</div>;

  const badge = STATUS_BADGE[log.status];
  const canModerate = role === "ADMIN" || role === "MANAGER";
  const present = log.entries.filter((e) => !e.isAbsent);
  const hasCost = present.some((e) => e.totalCost !== undefined);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/jobs/${jobId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" /> Job
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">
          Daily Log — {format(new Date(`${date}T12:00:00`), "EEEE, MMM d, yyyy")}
        </h1>
        <Badge className={badge.className}>{badge.label}</Badge>
        <div className="flex-1" />
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
              onClick={() => transition.mutate({ action: "approve" })}
              disabled={transition.isPending}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
            </Button>
          </>
        )}
        {role === "ADMIN" && log.status === "APPROVED" && (
          <Button
            variant="outline"
            onClick={() => {
              if (confirm("Reopen this approved log? Hours become editable again.")) {
                transition.mutate({ action: "reopen" });
              }
            }}
            disabled={transition.isPending}
          >
            <RotateCcw className="mr-1 h-4 w-4" /> Reopen
          </Button>
        )}
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
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
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
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
