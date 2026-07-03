"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, MapPin, TriangleAlert } from "lucide-react";

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

export default function FieldHomePage() {
  const today = localToday();
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
    </div>
  );
}
