"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Download, ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCsv, downloadCsv } from "@/lib/csv";

const stageColors: Record<string, string> = {
  "Won": "bg-green-100 text-green-800",
  "Deposit Needed": "bg-amber-100 text-amber-800",
  "Financing Cleared": "bg-blue-100 text-blue-800",
  "Permit Submitted": "bg-purple-100 text-purple-800",
  "Permit Approved": "bg-teal-100 text-teal-800",
  "Scheduled": "bg-indigo-100 text-indigo-800",
  "In Progress": "bg-cyan-100 text-cyan-800",
  "Final Payment Due": "bg-orange-100 text-orange-800",
  "Closed": "bg-gray-100 text-gray-800",
};

const ASSIGNABLE_ROLES = new Set(["ADMIN", "MANAGER", "SALES_REP"]);
const UNASSIGN_VALUE = "__unassigned";

type JobRow = {
  id: string;
  jobNumber: string;
  title: string;
  serviceType: string;
  jobType: "FIXED_PRICE" | "COST_PLUS";
  contractAmount: string;
  depositReceived: string;
  depositRequired: string;
  balanceDue: string;
  nextAction: string | null;
  scheduledDate: string | null;
  currentStageId: string;
  currentStage: { id: string; name: string };
  lead: { fullName: string; propertyAddress1: string; city: string };
  salesRepId: string | null;
  salesRep: { id: string; firstName: string; lastName: string } | null;
  projectManagerId: string | null;
  projectManager: { id: string; firstName: string; lastName: string } | null;
  permits: { status: string }[];
  createdAt: string;
  taskCounts?: { pending: number; overdue: number };
};

type Assignee = {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  role: { name: string };
};

export default function JobsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stageId, setStageId] = useState("");
  const [salesRepFilter, setSalesRepFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignTo, setBulkAssignTo] = useState("");
  const [bulkStage, setBulkStage] = useState("");

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (stageId) params.set("stageId", stageId);
  if (salesRepFilter) params.set("salesRepId", salesRepFilter);
  params.set("page", String(page));
  params.set("withTaskCounts", "true");

  const { data, isLoading } = useQuery<{
    data: JobRow[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: ["jobs", search, stageId, salesRepFilter, page],
    queryFn: () => fetch(`/api/jobs?${params.toString()}`).then((r) => r.json()),
  });

  const { data: stages } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["jobStages"],
    queryFn: () => fetch("/api/jobs/stages").then((r) => r.json()),
  });

  const { data: users } = useQuery<Assignee[]>({
    queryKey: ["assignable-users"],
    queryFn: () => fetch("/api/admin/users").then((r) => r.json()),
  });

  const assignableUsers = useMemo(
    () => (users ?? []).filter((u) => u.isActive && ASSIGNABLE_ROLES.has(u.role.name)),
    [users],
  );

  const changeStage = useMutation({
    mutationFn: ({ jobId, stageId }: { jobId: string; stageId: string }) =>
      fetch(`/api/jobs/${jobId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to update stage");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Stage updated");
    },
    onError: () => toast.error("Failed to update stage"),
  });

  const assignJob = useMutation({
    mutationFn: ({ jobId, salesRepId }: { jobId: string; salesRepId: string }) =>
      fetch(`/api/jobs/${jobId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesRepId }),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to assign");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Sales rep updated");
    },
    onError: () => toast.error("Failed to assign"),
  });

  const bulkAssign = useMutation({
    mutationFn: () =>
      fetch(`/api/jobs/bulk-assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds: [...selected],
          salesRepId: bulkAssignTo,
        }),
      }).then((r) => {
        if (!r.ok) throw new Error("Bulk assign failed");
        return r.json() as Promise<{ updated: number; requested: number }>;
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(`Assigned ${result.updated} of ${result.requested} jobs`);
      setSelected(new Set());
      setBulkAssignTo("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkStageMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/jobs/bulk-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds: [...selected],
          stageId: bulkStage,
        }),
      }).then((r) => {
        if (!r.ok) throw new Error("Bulk stage change failed");
        return r.json() as Promise<{ updated: number; requested: number }>;
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(`Updated ${result.updated} of ${result.requested} jobs`);
      setSelected(new Set());
      setBulkStage("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allRowIds = data?.data?.map((j) => j.id) ?? [];
  const allSelected = allRowIds.length > 0 && allRowIds.every((id) => selected.has(id));

  function toggleRow(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => {
      if (allSelected) return new Set();
      const next = new Set(s);
      for (const id of allRowIds) next.add(id);
      return next;
    });
  }

  return (
    <div>
      <PageHeader
        title="Jobs"
        description={`${data?.total || 0} active jobs`}
        actions={
          <Button
            variant="outline"
            onClick={async () => {
              const exportParams = new URLSearchParams(params);
              exportParams.set("pageSize", "5000");
              exportParams.delete("page");
              exportParams.delete("withTaskCounts");
              const res = await fetch(`/api/jobs?${exportParams.toString()}`);
              const body = await res.json();
              const rows = (body.data || []).map((j: JobRow) => ({
                jobNumber: j.jobNumber,
                title: j.title,
                customer: j.lead.fullName,
                serviceType: j.serviceType,
                stage: j.currentStage.name,
                contractAmount: j.contractAmount,
                depositReceived: j.depositReceived,
                balanceDue: j.balanceDue,
                salesRep: j.salesRep
                  ? `${j.salesRep.firstName} ${j.salesRep.lastName}`
                  : "",
                scheduledDate: j.scheduledDate ?? "",
                createdAt: j.createdAt,
              }));
              const csv = toCsv(rows, [
                { key: "jobNumber", header: "Job #" },
                { key: "title", header: "Title" },
                { key: "customer", header: "Customer" },
                { key: "serviceType", header: "Service" },
                { key: "stage", header: "Stage" },
                { key: "contractAmount", header: "Contract" },
                { key: "depositReceived", header: "Deposit" },
                { key: "balanceDue", header: "Balance" },
                { key: "salesRep", header: "Sales Rep" },
                { key: "scheduledDate", header: "Scheduled" },
                { key: "createdAt", header: "Created" },
              ]);
              downloadCsv(`jobs-${new Date().toISOString().slice(0, 10)}.csv`, csv);
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search jobs..."
            className="pl-9"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={stageId}
          onValueChange={(v: string | null) => {
            setStageId(!v || v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Stages">
              {(v: string) =>
                !v
                  ? "All Stages"
                  : stages?.find((s) => s.id === v)?.name ?? "All Stages"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {stages?.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={salesRepFilter}
          onValueChange={(v: string | null) => {
            setSalesRepFilter(!v || v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Reps">
              {(v: string) => {
                if (!v) return "All Reps";
                const u = assignableUsers.find((x) => x.id === v);
                return u ? `${u.firstName} ${u.lastName}` : "All Reps";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Reps</SelectItem>
            {assignableUsers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 font-medium text-blue-900">
            <ListChecks className="h-4 w-4" />
            {selected.size} selected
          </span>

          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-900">Assign rep:</span>
            <Select value={bulkAssignTo} onValueChange={(v: string | null) => setBulkAssignTo(v ?? "")}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Pick user">
                  {(v: string) => {
                    const u = assignableUsers.find((x) => x.id === v);
                    return u ? `${u.firstName} ${u.lastName}` : "Pick user";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {assignableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!bulkAssignTo || bulkAssign.isPending}
              onClick={() => bulkAssign.mutate()}
            >
              {bulkAssign.isPending ? "Assigning…" : "Apply"}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-900">Move to stage:</span>
            <Select value={bulkStage} onValueChange={(v: string | null) => setBulkStage(v ?? "")}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Pick stage">
                  {(v: string) =>
                    stages?.find((s) => s.id === v)?.name ?? "Pick stage"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {stages?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!bulkStage || bulkStageMutation.isPending}
              onClick={() => bulkStageMutation.mutate()}
            >
              {bulkStageMutation.isPending ? "Updating…" : "Apply"}
            </Button>
          </div>

          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            <X className="mr-1 h-3 w-3" />
            Clear
          </Button>
        </div>
      )}

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all on page"
                />
              </TableHead>
              <TableHead>Job #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Contract</TableHead>
              <TableHead>Deposit</TableHead>
              <TableHead>Permit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Next Action</TableHead>
              <TableHead>Rep</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
            ) : !data?.data?.length ? (
              <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">No jobs found</TableCell></TableRow>
            ) : (
              data.data.map((job) => {
                const depositPct = Number(job.depositRequired) > 0
                  ? Math.round((Number(job.depositReceived) / Number(job.depositRequired)) * 100)
                  : 0;
                const hasPermit = job.permits?.length > 0;
                const permitStatus = hasPermit ? job.permits[0].status : null;
                const taskCount = job.taskCounts?.pending ?? 0;
                const overdueTasks = job.taskCounts?.overdue ?? 0;

                return (
                  <TableRow
                    key={job.id}
                    className={`cursor-pointer hover:bg-gray-50 ${
                      selected.has(job.id) ? "bg-blue-50/50" : ""
                    }`}
                    onClick={() => router.push(`/jobs/${job.id}`)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(job.id)}
                        onChange={() => toggleRow(job.id)}
                        aria-label={`Select ${job.jobNumber}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm font-medium">{job.jobNumber}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium text-sm">{job.lead.fullName}</div>
                          <div className="text-xs text-muted-foreground">{job.lead.propertyAddress1}, {job.lead.city}</div>
                        </div>
                        {taskCount > 0 && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1 py-0 ${
                              overdueTasks > 0
                                ? "border-red-500 text-red-700"
                                : "border-blue-300 text-blue-700"
                            }`}
                            title={
                              overdueTasks > 0
                                ? `${overdueTasks} overdue, ${taskCount} total open`
                                : `${taskCount} open task${taskCount === 1 ? "" : "s"}`
                            }
                          >
                            {overdueTasks > 0 ? `⚠ ${overdueTasks}/${taskCount}` : `${taskCount}`} task{taskCount === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{job.serviceType}</Badge></TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={job.currentStageId}
                        onValueChange={(v: string | null) => {
                          if (v && v !== job.currentStageId) {
                            changeStage.mutate({ jobId: job.id, stageId: v });
                          }
                        }}
                      >
                        <SelectTrigger
                          className={`h-7 w-[170px] text-xs border-0 ${stageColors[job.currentStage.name] || "bg-gray-100"}`}
                        >
                          <SelectValue>
                            {(v: string) =>
                              stages?.find((s) => s.id === v)?.name ?? job.currentStage.name
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {stages?.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <div>${Number(job.contractAmount).toLocaleString()}</div>
                      {job.jobType === "COST_PLUS" && (
                        <div className="text-[10px] font-normal text-muted-foreground">Cost+</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${depositPct >= 100 ? "bg-green-500" : "bg-amber-500"}`} style={{ width: `${Math.min(depositPct, 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{depositPct}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {hasPermit ? (
                        <Badge variant="outline" className="text-[10px]">{permitStatus}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={Number(job.balanceDue) > 0 ? "font-medium" : "text-green-600"}>
                        ${Number(job.balanceDue).toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      {job.nextAction ? (
                        <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">{job.nextAction}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={job.salesRep?.id ?? UNASSIGN_VALUE}
                        onValueChange={(v: string | null) => {
                          if (!v || v === UNASSIGN_VALUE) return;
                          if (v !== job.salesRep?.id) {
                            assignJob.mutate({ jobId: job.id, salesRepId: v });
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 w-[150px] text-xs">
                          <SelectValue>
                            {(v: string) => {
                              if (!v || v === UNASSIGN_VALUE) return "Unassigned";
                              const u = assignableUsers.find((x) => x.id === v);
                              return u
                                ? `${u.firstName} ${u.lastName[0]}.`
                                : job.salesRep
                                  ? `${job.salesRep.firstName} ${job.salesRep.lastName[0]}.`
                                  : "Unassigned";
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {!job.salesRep && (
                            <SelectItem value={UNASSIGN_VALUE} disabled>
                              Unassigned
                            </SelectItem>
                          )}
                          {assignableUsers.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.firstName} {u.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {data?.totalPages && data.totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
