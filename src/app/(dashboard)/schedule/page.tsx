"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

type ScheduledJob = {
  id: string;
  jobNumber: string;
  title: string;
  serviceType: string;
  scheduledDate: string | null;
  currentStage: { name: string };
  lead: { fullName: string; city: string };
  crewAssignments: { crew: { name: string; tradeType: string } }[];
};

export default function SchedulePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const { data: jobsData } = useQuery({
    queryKey: ["jobs", "schedule"],
    queryFn: () => fetch("/api/jobs?pageSize=500").then((r) => r.json()),
  });

  const { data: crews } = useQuery({
    queryKey: ["crews"],
    queryFn: () => fetch("/api/crews").then((r) => r.json()),
  });

  const updateJob = useMutation({
    mutationFn: ({ id, scheduledDate }: { id: string; scheduledDate: string }) =>
      fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledDate }),
      }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); toast.success("Job scheduled"); },
  });

  const assignCrew = useMutation({
    mutationFn: ({ jobId, crewId, installDate }: { jobId: string; crewId: string; installDate?: string }) =>
      fetch(`/api/jobs/${jobId}/crews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewId, installDate }),
      }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["crews"] }); toast.success("Crew assigned"); },
  });

  const jobs: ScheduledJob[] = jobsData?.data || [];
  const scheduledJobs = jobs.filter((j) => j.scheduledDate);
  const unscheduledJobs = jobs.filter(
    (j) => !j.scheduledDate && !["Closed", "Won", "Deposit Needed"].includes(j.currentStage.name)
  );

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div>
      <PageHeader title="Schedule" description="Installation calendar and crew assignments" />

      {/* Week navigation */}
      <div className="flex items-center gap-4 mb-4">
        <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {format(weekStart, "MMM d")} — {format(addDays(weekStart, 6), "MMM d, yyyy")}
        </span>
        <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
          Today
        </Button>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-2 mb-6">
        {weekDays.map((day) => {
          const dayJobs = scheduledJobs.filter(
            (j) => j.scheduledDate && isSameDay(new Date(j.scheduledDate), day)
          );
          const isToday = isSameDay(day, new Date());

          return (
            <div key={day.toISOString()} className={`rounded-lg border min-h-[200px] ${isToday ? "border-blue-300 bg-blue-50/30" : "bg-white"}`}>
              <div className={`px-2 py-1 border-b text-xs font-medium ${isToday ? "text-blue-700" : "text-muted-foreground"}`}>
                {format(day, "EEE d")}
              </div>
              <div className="p-1 space-y-1">
                {dayJobs.map((j) => (
                  <div
                    key={j.id}
                    className="p-1.5 bg-blue-50 rounded text-[10px] cursor-pointer hover:bg-blue-100 transition-colors"
                    onClick={() => router.push(`/jobs/${j.id}`)}
                  >
                    <div className="font-medium">{j.jobNumber}</div>
                    <div className="text-muted-foreground">{j.lead.fullName}</div>
                    <div className="text-muted-foreground">{j.serviceType}</div>
                    {j.crewAssignments?.[0] && (
                      <Badge variant="outline" className="text-[8px] mt-0.5 px-1 py-0">
                        {j.crewAssignments[0].crew.name}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Unscheduled jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Unscheduled Jobs ({unscheduledJobs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {unscheduledJobs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">All jobs scheduled</p>
          ) : (
            <div className="space-y-2">
              {unscheduledJobs.map((j) => (
                <div key={j.id} className="flex items-center gap-3 p-2 border rounded-lg">
                  <div className="flex-1 cursor-pointer" onClick={() => router.push(`/jobs/${j.id}`)}>
                    <span className="font-mono text-xs mr-2">{j.jobNumber}</span>
                    <span className="text-sm">{j.lead.fullName}</span>
                    <Badge variant="outline" className="text-[10px] ml-2">{j.currentStage.name}</Badge>
                  </div>
                  <Input
                    type="date"
                    className="w-[150px] h-8 text-xs"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      if (e.target.value) updateJob.mutate({ id: j.id, scheduledDate: e.target.value });
                    }}
                  />
                  <Select onValueChange={(v: string | null) => v && assignCrew.mutate({ jobId: j.id, crewId: v })}>
                    <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Assign crew" /></SelectTrigger>
                    <SelectContent>
                      {(crews || []).filter((c: { isActive: boolean }) => c.isActive).map((c: { id: string; name: string }) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
