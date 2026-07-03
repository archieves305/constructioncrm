"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowLeft, FileDown, Mail, Trash2 } from "lucide-react";

type LogSummary = {
  id: string;
  logDate: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
  returnNote: string | null;
  workersOnsite: number;
  totalHours: number;
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  SUBMITTED: { label: "Submitted", className: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved", className: "bg-green-100 text-green-800" },
};

export default function FieldLogsListPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

  const { data: logs = [], isLoading } = useQuery<LogSummary[]>({
    queryKey: ["daily-logs", jobId],
    queryFn: () => fetch(`/api/jobs/${jobId}/daily-logs`).then((r) => r.json()),
  });

  const { data: fieldToday } = useQuery<{
    jobs: { id: string; title: string; jobNumber: string }[];
  }>({
    queryKey: ["field-today-jobs"],
    queryFn: () => fetch("/api/field/today").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const job = fieldToday?.jobs.find((j) => j.id === jobId);

  const [emailFor, setEmailFor] = useState<string | null>(null); // logDate
  const [emailTo, setEmailTo] = useState("");
  const [emailNote, setEmailNote] = useState("");

  const sendEmail = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/jobs/${jobId}/daily-logs/${emailFor}/email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: emailTo.trim(),
            note: emailNote.trim() || null,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to send");
      return body as { sentTo: string };
    },
    onSuccess: (d) => {
      setEmailFor(null);
      setEmailNote("");
      toast.success(`Daily report sent to ${d.sentTo}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteLog = useMutation({
    mutationFn: async (logDate: string) => {
      const res = await fetch(`/api/jobs/${jobId}/daily-logs/${logDate}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-logs", jobId] });
      qc.invalidateQueries({ queryKey: ["field-today"] });
      toast.success("Daily log deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push("/field")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">Daily Logs</h1>
          <p className="text-muted-foreground truncate text-sm">
            {job ? `${job.jobNumber} — ${job.title}` : ""}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center">
            No daily logs yet on this job.
          </CardContent>
        </Card>
      ) : (
        logs.map((log) => {
          const badge = STATUS_BADGE[log.status];
          return (
            <Card key={log.id}>
              <CardContent className="space-y-3 py-4">
                <Link
                  href={`/field/jobs/${jobId}/daily/${log.logDate}`}
                  className="flex items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold">
                      {format(new Date(`${log.logDate}T12:00:00`), "EEEE, MMM d, yyyy")}
                    </div>
                    <div className="text-muted-foreground text-sm">
                      {log.workersOnsite} workers · {log.totalHours}h
                    </div>
                  </div>
                  <Badge className={badge.className}>
                    {log.returnNote && log.status === "DRAFT" ? "Returned" : badge.label}
                  </Badge>
                </Link>
                <div className="flex gap-2">
                  <a
                    href={`/api/jobs/${jobId}/daily-logs/${log.logDate}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1"
                  >
                    <Button variant="outline" className="h-11 w-full">
                      <FileDown className="mr-1 h-4 w-4" /> PDF
                    </Button>
                  </a>
                  <Button
                    variant="outline"
                    className="h-11 flex-1"
                    onClick={() => {
                      setEmailFor(log.logDate);
                      setEmailTo("");
                      setEmailNote("");
                    }}
                  >
                    <Mail className="mr-1 h-4 w-4" /> Email
                  </Button>
                  {log.status === "DRAFT" && (
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={() => {
                        if (
                          confirm(
                            `Delete the ${format(new Date(`${log.logDate}T12:00:00`), "MMM d")} log? Crew hours and notes for that day will be removed.`,
                          )
                        ) {
                          deleteLog.mutate(log.logDate);
                        }
                      }}
                      disabled={deleteLog.isPending}
                      aria-label="Delete log"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <Dialog open={emailFor !== null} onOpenChange={(o) => !o && setEmailFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Email daily report
              {emailFor
                ? ` — ${format(new Date(`${emailFor}T12:00:00`), "MMM d")}`
                : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Sends the report as a PDF (crew, work performed, photos — no
              internal costs).
            </p>
            <Input
              type="email"
              placeholder="who@example.com"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              style={{ fontSize: 16 }}
              autoComplete="email"
            />
            <Textarea
              rows={3}
              placeholder="Message (optional)"
              value={emailNote}
              onChange={(e) => setEmailNote(e.target.value)}
              style={{ fontSize: 16 }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEmailFor(null)}>
                Cancel
              </Button>
              <Button
                disabled={!emailTo.trim() || sendEmail.isPending}
                onClick={() => sendEmail.mutate()}
              >
                {sendEmail.isPending ? "Sending…" : "Send report"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
