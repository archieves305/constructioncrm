"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertTriangle, Shield } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  APPLIED: "bg-blue-100 text-blue-800",
  IN_PROGRESS: "bg-purple-100 text-purple-800",
  ISSUED: "bg-teal-100 text-teal-800",
  FINAL: "bg-green-100 text-green-800",
  EXPIRED: "bg-gray-100 text-gray-800",
  DENIED: "bg-red-100 text-red-800",
};

const BOARD_STATUSES = ["APPLIED", "IN_PROGRESS", "ISSUED", "FINAL", "DENIED"];

type PermitRow = {
  id: string;
  municipality: string;
  permitType: string | null;
  permitNumber: string | null;
  status: string;
  submittedDate: string | null;
  approvedDate: string | null;
  agingDays: number | null;
  notes: string | null;
  job: {
    id: string;
    jobNumber: string;
    title: string;
    lead: { fullName: string; propertyAddress1: string; city: string; county: string | null };
  };
  assignedTo: { id: string; firstName: string; lastName: string } | null;
};

export default function PermitCenterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState("board");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterMuni, setFilterMuni] = useState("");

  const params = new URLSearchParams();
  if (filterStatus) params.set("status", filterStatus);
  if (filterMuni) params.set("municipality", filterMuni);
  if (tab === "aging") params.set("aging", "true");

  const { data: permits, isLoading } = useQuery({
    queryKey: ["permits", tab, filterStatus, filterMuni],
    queryFn: () => fetch(`/api/permits?${params.toString()}`).then((r) => r.json()),
  });

  const updatePermit = useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; notes?: string }) =>
      fetch(`/api/permits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["permits"] }); toast.success("Permit updated"); },
  });

  const allPermits: PermitRow[] = permits || [];
  const municipalities = [...new Set(allPermits.map((p) => p.municipality))].sort();

  return (
    <div>
      <PageHeader title="Permit Center" description={`${allPermits.length} permits tracked`} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="list">List View</TabsTrigger>
          <TabsTrigger value="aging">Aging Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          <div className="flex gap-3 overflow-x-auto pb-4">
            {BOARD_STATUSES.map((status) => {
              const statusPermits = allPermits.filter((p) => p.status === status);
              return (
                <div key={status} className="flex-shrink-0 w-[280px] rounded-lg border bg-gray-50">
                  <div className="flex items-center justify-between border-b bg-white px-3 py-2 rounded-t-lg">
                    <Badge variant="outline" className={`text-xs border-0 ${STATUS_COLORS[status] || ""}`}>
                      {status.replace("_", " ")}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">{statusPermits.length}</Badge>
                  </div>
                  <ScrollArea className="h-[calc(100vh-260px)]">
                    <div className="space-y-2 p-2">
                      {statusPermits.map((p) => (
                        <Card key={p.id} className="cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => router.push(`/jobs/${p.job.id}`)}>
                          <CardContent className="p-3 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-mono">{p.job.jobNumber}</span>
                              {p.agingDays && p.agingDays > 14 && (
                                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                              )}
                            </div>
                            <p className="text-xs font-medium">{p.job.lead.fullName}</p>
                            <p className="text-[10px] text-muted-foreground">{p.municipality}</p>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">
                                {p.permitType || "General"}
                              </span>
                              {p.agingDays !== null && (
                                <span className={`text-[10px] ${p.agingDays > 14 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                                  {p.agingDays}d
                                </span>
                              )}
                            </div>
                            <Select value={p.status}
                              onValueChange={(v: string | null) => v && updatePermit.mutate({ id: p.id, status: v })}>
                              <SelectTrigger className="h-6 text-[10px] mt-1"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {BOARD_STATUSES.map((s) => (
                                  <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </CardContent>
                        </Card>
                      ))}
                      {statusPermits.length === 0 && (
                        <p className="py-4 text-center text-[10px] text-muted-foreground">None</p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          <div className="mb-4 flex gap-3">
            <Select value={filterStatus} onValueChange={(v: string | null) => setFilterStatus(!v || v === "all" ? "" : v)}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {BOARD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterMuni} onValueChange={(v: string | null) => setFilterMuni(!v || v === "all" ? "" : v)}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Municipalities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Municipalities</SelectItem>
                {municipalities.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Municipality</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Aging</TableHead>
                  <TableHead>Coordinator</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allPermits.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/jobs/${p.job.id}`)}>
                    <TableCell className="font-mono text-xs">{p.job.jobNumber}</TableCell>
                    <TableCell className="text-sm">{p.job.lead.fullName}</TableCell>
                    <TableCell className="text-sm">{p.municipality}</TableCell>
                    <TableCell className="text-sm">{p.permitType || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs border-0 ${STATUS_COLORS[p.status] || ""}`}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{p.submittedDate ? format(new Date(p.submittedDate), "MMM d, yyyy") : "—"}</TableCell>
                    <TableCell>
                      {p.agingDays !== null ? (
                        <span className={p.agingDays > 14 ? "text-red-600 font-medium text-sm" : "text-sm"}>
                          {p.agingDays} days
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.assignedTo ? `${p.assignedTo.firstName} ${p.assignedTo.lastName}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="aging" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Aging Permits (&gt; 14 days without approval)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
              ) : allPermits.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No aging permits</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Municipality</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allPermits.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.job.jobNumber}</TableCell>
                        <TableCell>{p.job.lead.fullName}</TableCell>
                        <TableCell>{p.municipality}</TableCell>
                        <TableCell className="text-red-600 font-medium">{p.agingDays}d</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{p.status}</Badge></TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => router.push(`/jobs/${p.job.id}`)}>
                            View Job
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
