"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin } from "lucide-react";

type FieldJob = {
  id: string;
  jobNumber: string;
  title: string;
  serviceType: string;
  scheduledDate: string | null;
  currentStage: { name: string };
  lead: { propertyAddress1: string | null; city: string | null };
};

export default function FieldHomePage() {
  const { data, isLoading } = useQuery<{ jobs: FieldJob[] }>({
    queryKey: ["field-today"],
    queryFn: () => fetch("/api/field/today").then((r) => r.json()),
  });

  const jobs = data?.jobs ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
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
        jobs.map((job) => (
          <Card key={job.id}>
            <CardContent className="flex min-h-[72px] items-center gap-4 py-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold">
                  {job.title}
                </div>
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
              <Badge variant="secondary">{job.currentStage.name}</Badge>
            </CardContent>
          </Card>
        ))
      )}

      <p className="text-muted-foreground pt-2 text-center text-sm">
        Daily logs and crew hours arrive here in the next update.
      </p>
    </div>
  );
}
