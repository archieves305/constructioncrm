"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Hammer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { fetchJson } from "@/lib/fetch-json";
import { JobPersonnelScopePanel } from "./job-personnel-scope-panel";

export type CrewAssignment = { id: string; crew: { name: string; trades: string[] }; installDate: string | null };

/** Assign a crew (with an optional install date) and list the assignments. Moved out of the job page verbatim. */
export function CrewsPanel({ jobId, crewAssignments }: { jobId: string; crewAssignments: CrewAssignment[] }) {
  const qc = useQueryClient();
  const [assignCrewId, setAssignCrewId] = useState("");
  const [assignInstallDate, setAssignInstallDate] = useState("");

  const { data: crews = [] } = useQuery<{ id: string; name: string; trades: string[] }[]>({
    queryKey: ["crews", "active"],
    queryFn: () => fetchJson("/api/crews?activeOnly=true"),
  });

  const assignCrew = useMutation({
    mutationFn: (data: { crewId: string; installDate: string }) =>
      fetchJson(`/api/jobs/${jobId}/crews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewId: data.crewId, installDate: data.installDate || null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      setAssignCrewId("");
      setAssignInstallDate("");
      toast.success("Crew assigned");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-2">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-4">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-[11px]">Crew</Label>
            <Select value={assignCrewId || "__none"} onValueChange={(v: string | null) => setAssignCrewId(!v || v === "__none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a crew">{(v: string) => (!v || v === "__none" ? "Select a crew" : crews.find((c) => c.id === v)?.name || "Select a crew")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {crews.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.trades?.length ? ` — ${c.trades.join(", ")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Install date (optional)</Label>
            <Input type="date" value={assignInstallDate} onChange={(e) => setAssignInstallDate(e.target.value)} />
          </div>
          <Button size="sm" disabled={!assignCrewId || assignCrew.isPending} onClick={() => assignCrew.mutate({ crewId: assignCrewId, installDate: assignInstallDate })}>
            Assign crew
          </Button>
        </CardContent>
      </Card>
      {crewAssignments.map((ca) => (
        <Card key={ca.id}>
          <CardContent className="flex items-center justify-between py-3 px-4">
            <div>
              <span className="text-sm font-medium">{ca.crew.name}</span>
              <Badge variant="outline" className="text-[10px] ml-2">{ca.crew.trades?.join(", ") || "—"}</Badge>
            </div>
            {ca.installDate && <span className="text-xs text-muted-foreground">{format(new Date(ca.installDate), "MMM d, yyyy")}</span>}
          </CardContent>
        </Card>
      ))}
      {crewAssignments.length === 0 && <EmptyState icon={Hammer} title="No crews assigned" description="Pick a crew above; field mode and the schedule read from this." />}
      <JobPersonnelScopePanel jobId={jobId} />
    </div>
  );
}
