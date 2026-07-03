"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ChevronRight, Mail, MapPin, TriangleAlert } from "lucide-react";

type FieldJob = {
  id: string;
  jobNumber: string;
  title: string;
  serviceType: string;
  scheduledDate: string | null;
  currentStage: { name: string };
  lead: { propertyAddress1: string | null; city: string | null };
  todayLog: { status: string; returned: boolean; crewCount: number } | null;
  yesterdayUnsubmitted: boolean;
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const LOG_CHIP: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  SUBMITTED: { label: "Submitted", className: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved", className: "bg-green-100 text-green-800" },
};

function lastMonday(): string {
  const d = new Date();
  const diff = (d.getDay() - 1 + 7) % 7 || 7; // most recent completed Monday
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function FieldHomePage() {
  const today = localToday();
  const [emailOpen, setEmailOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(lastMonday());
  const emailWeekly = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/reports/field-labor/email-weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to send");
      return body as { sentTo: string; workers: number; weekStart: string };
    },
    onSuccess: (d) => {
      setEmailOpen(false);
      toast.success(`Hours for ${d.workers} workers sent to ${d.sentTo}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const { data, isLoading } = useQuery<{ date: string; jobs: FieldJob[] }>({
    queryKey: ["field-today", today],
    queryFn: () => fetch(`/api/field/today?date=${today}`).then((r) => r.json()),
  });

  const jobs = data?.jobs ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <h1 className="text-xl font-bold">My Jobs</h1>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center">
            No active jobs assigned to you. Ask the office to assign you to a
            job.
          </CardContent>
        </Card>
      ) : (
        jobs.map((job) => {
          const chip = job.todayLog ? LOG_CHIP[job.todayLog.status] : null;
          return (
            <Card key={job.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">{job.title}</div>
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <span>{job.jobNumber}</span>
                      {(job.lead.propertyAddress1 || job.lead.city) && (
                        <span className="flex min-w-0 items-center gap-1 truncate">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          {[job.lead.propertyAddress1, job.lead.city]
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  {chip ? (
                    <Badge className={chip.className}>
                      {job.todayLog!.returned ? "Returned" : chip.label}
                      {job.todayLog!.crewCount > 0 && ` · ${job.todayLog!.crewCount} crew`}
                    </Badge>
                  ) : (
                    <Badge variant="outline">No log today</Badge>
                  )}
                </div>

                {job.yesterdayUnsubmitted && (
                  <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <TriangleAlert className="h-4 w-4 shrink-0" />
                    Yesterday&apos;s log was never submitted
                  </div>
                )}

                <Link href={`/field/jobs/${job.id}/daily/${today}`} className="block">
                  <Button className="h-12 w-full justify-between text-base">
                    {job.todayLog
                      ? job.todayLog.status === "DRAFT"
                        ? "Continue today's log"
                        : "View today's log"
                      : "Start today's log"}
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          );
        })
      )}
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <Mail className="h-5 w-5 shrink-0 text-blue-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Weekly hours to bookkeeper</div>
            <p className="text-muted-foreground text-xs">
              Emails the week&apos;s hours and pay so she can run payment.
            </p>
          </div>
          <Button variant="outline" className="h-11" onClick={() => setEmailOpen(true)}>
            Send
          </Button>
        </CardContent>
      </Card>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email weekly hours</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Sends every worker&apos;s hours, rate, and gross for the payroll
              week to the bookkeeper on file, with a CSV attached. Pick any day
              in the week you want.
            </p>
            <Input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              style={{ fontSize: 16 }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEmailOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!weekStart || emailWeekly.isPending}
                onClick={() => emailWeekly.mutate()}
              >
                {emailWeekly.isPending ? "Sending…" : "Send to bookkeeper"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
