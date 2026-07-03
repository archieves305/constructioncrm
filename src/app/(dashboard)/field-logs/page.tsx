"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

type QueueRow = {
  id: string;
  jobId: string;
  logDate: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
  submittedAt: string | null;
  job: { id: string; jobNumber: string; title: string };
  manager: { firstName: string; lastName: string } | null;
  submittedBy: { firstName: string; lastName: string } | null;
  workersOnsite: number;
  totalHours: number;
  totalCost?: number;
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  SUBMITTED: { label: "Submitted", className: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved", className: "bg-green-100 text-green-800" },
};

const FILTERS = [
  { value: "SUBMITTED", label: "Awaiting approval" },
  { value: "DRAFT", label: "Drafts" },
  { value: "APPROVED", label: "Approved" },
  { value: "", label: "All" },
];

export default function FieldLogsQueuePage() {
  const [status, setStatus] = useState("SUBMITTED");

  const { data: logs = [], isLoading } = useQuery<QueueRow[]>({
    queryKey: ["field-logs", status],
    queryFn: () =>
      fetch(`/api/field-logs${status ? `?status=${status}` : ""}`).then((r) =>
        r.json(),
      ),
  });

  const hasCost = logs.some((l) => l.totalCost !== undefined);

  return (
    <div className="p-6">
      <PageHeader
        title="Daily Logs"
        description="Field daily reports across all jobs"
      />

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={status === f.value ? "default" : "outline"}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="text-muted-foreground rounded-md border py-12 text-center">
          {status === "SUBMITTED"
            ? "Nothing waiting for approval."
            : "No logs found."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Crew lead</TableHead>
                <TableHead className="text-right">Workers</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                {hasCost && <TableHead className="text-right">Cost</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const badge = STATUS_BADGE[log.status];
                return (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Link
                        href={`/jobs/${log.jobId}/daily-logs/${log.logDate}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {format(new Date(`${log.logDate}T12:00:00`), "EEE, MMM d")}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/jobs/${log.jobId}`} className="hover:underline">
                        {log.job.jobNumber} — {log.job.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {log.manager
                        ? `${log.manager.firstName} ${log.manager.lastName}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">{log.workersOnsite}</TableCell>
                    <TableCell className="text-right">{log.totalHours}</TableCell>
                    {hasCost && (
                      <TableCell className="text-right">
                        {log.totalCost != null
                          ? `$${log.totalCost.toLocaleString()}`
                          : "—"}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
