"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
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
import { HardHat } from "lucide-react";

type LogSummary = {
  id: string;
  logDate: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
  submittedAt: string | null;
  approvedAt: string | null;
  returnNote: string | null;
  manager: { id: string; firstName: string; lastName: string } | null;
  workersOnsite: number;
  totalHours: number;
  totalCost?: number;
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  SUBMITTED: { label: "Submitted", className: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved", className: "bg-green-100 text-green-800" },
};

export function DailyLogsPanel({ jobId }: { jobId: string }) {
  const { data: logs = [], isLoading } = useQuery<LogSummary[]>({
    queryKey: ["daily-logs", jobId],
    queryFn: () => fetch(`/api/jobs/${jobId}/daily-logs`).then((r) => r.json()),
  });

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const hasCost = logs.some((l) => l.totalCost !== undefined);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Daily Logs</h3>
        <Link href={`/field/jobs/${jobId}/daily/${todayStr}`}>
          <Button variant="outline" size="sm">
            <HardHat className="mr-1 h-4 w-4" />
            Open in Field Mode
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-8 text-center">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="text-muted-foreground rounded-md border py-8 text-center">
          No daily logs yet. Crews create them from Field Mode.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
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
                        href={`/jobs/${jobId}/daily-logs/${log.logDate}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {format(new Date(`${log.logDate}T12:00:00`), "EEE, MMM d, yyyy")}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={badge.className}>
                        {log.returnNote && log.status === "DRAFT" ? "Returned" : badge.label}
                      </Badge>
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
