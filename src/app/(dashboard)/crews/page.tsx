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
import { format } from "date-fns";
import { Plus, Users, Hammer } from "lucide-react";

type CrewData = {
  id: string;
  name: string;
  tradeType: string;
  isActive: boolean;
  assignments: {
    id: string;
    installDate: string | null;
    job: { id: string; jobNumber: string; title: string; scheduledDate: string | null };
  }[];
};

export default function CrewsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newTrade, setNewTrade] = useState("");

  const { data: crews, isLoading } = useQuery({
    queryKey: ["crews"],
    queryFn: () => fetch("/api/crews").then((r) => r.json()),
  });

  const createCrew = useMutation({
    mutationFn: () =>
      fetch("/api/crews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, tradeType: newTrade }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crews"] });
      setNewName(""); setNewTrade("");
      toast.success("Crew created");
    },
  });

  const toggleCrew = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetch(`/api/crews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["crews"] }); toast.success("Crew updated"); },
  });

  const allCrews: CrewData[] = crews || [];

  return (
    <div>
      <PageHeader title="Crews" description="Manage installation crews" />

      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input placeholder="Crew name" value={newName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)} className="max-w-xs" />
            <Select value={newTrade} onValueChange={(v: string | null) => setNewTrade(v ?? "")}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Trade type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Roofing">Roofing</SelectItem>
                <SelectItem value="Windows">Windows</SelectItem>
                <SelectItem value="Doors">Doors</SelectItem>
                <SelectItem value="Drywall">Drywall</SelectItem>
                <SelectItem value="Interior Renovations">Interior Renovations</SelectItem>
                <SelectItem value="General">General</SelectItem>
              </SelectContent>
            </Select>
            <Button disabled={!newName || !newTrade || createCrew.isPending} onClick={() => createCrew.mutate()}>
              <Plus className="mr-1 h-4 w-4" /> Add Crew
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {allCrews.map((crew) => (
          <Card key={crew.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{crew.name}</CardTitle>
                </div>
                <Badge variant={crew.isActive ? "default" : "secondary"} className="text-xs">
                  {crew.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Hammer className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{crew.tradeType}</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground mb-2">
                Active Jobs: {crew.assignments.length}
              </div>
              <div className="space-y-1 mb-3">
                {crew.assignments.slice(0, 5).map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs p-1.5 bg-gray-50 rounded cursor-pointer hover:bg-gray-100"
                    onClick={() => router.push(`/jobs/${a.job.id}`)}>
                    <span className="font-mono">{a.job.jobNumber}</span>
                    {a.installDate && <span className="text-muted-foreground">{format(new Date(a.installDate), "MMM d")}</span>}
                  </div>
                ))}
                {crew.assignments.length > 5 && (
                  <p className="text-[10px] text-muted-foreground">+{crew.assignments.length - 5} more</p>
                )}
              </div>
              <Button size="sm" variant="ghost" className="w-full text-xs"
                onClick={() => toggleCrew.mutate({ id: crew.id, isActive: !crew.isActive })}>
                {crew.isActive ? "Deactivate" : "Activate"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
