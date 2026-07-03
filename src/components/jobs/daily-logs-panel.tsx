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
import { FileDown, HardHat } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [packageOpen, setPackageOpen] = useState(false);
  const [pkgStart, setPkgStart] = useState("");
  const [pkgEnd, setPkgEnd] = useState("");
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
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={logs.length === 0}
            onClick={() => {
              setPkgEnd(logs[0]?.logDate ?? todayStr);
              setPkgStart(logs[Math.min(logs.length - 1, 13)]?.logDate ?? todayStr);
              setPackageOpen(true);
            }}
          >
            <FileDown className="mr-1 h-4 w-4" />
            Report package
          </Button>
          <Link href={`/field/jobs/${jobId}/daily/${todayStr}`}>
            <Button variant="outline" size="sm">
              <HardHat className="mr-1 h-4 w-4" />
              Open in Field Mode
            </Button>
          </Link>
        </div>
      </div>

      <Dialog open={packageOpen} onOpenChange={setPackageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Daily report package (PDF)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Bundles every daily report in the range — cover page, crew,
              narrative, and photos — into one PDF. Up to 14 days per package.
            </p>
            <div className="flex items-center gap-2">
              <Input type="date" value={pkgStart} onChange={(e) => setPkgStart(e.target.value)} />
              <span className="text-muted-foreground text-sm">to</span>
              <Input type="date" value={pkgEnd} onChange={(e) => setPkgEnd(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPackageOpen(false)}>
                Cancel
              </Button>
              <a
                href={`/api/jobs/${jobId}/daily-report-package?start=${pkgStart}&end=${pkgEnd}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button disabled={!pkgStart || !pkgEnd}>
                  <FileDown className="mr-1 h-4 w-4" /> Generate PDF
                </Button>
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
