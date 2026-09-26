"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jobLabel } from "@/lib/labels/job";
import { formatAddressLine } from "@/lib/labels/address";
import { JobRef } from "@/components/shared/entity-label";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { useListScope } from "@/components/shared/use-list-scope";
import { JobsBoard } from "@/components/jobs/jobs-board";
import { KanbanSquare, Table2 } from "lucide-react";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ListScope } from "@/lib/lists/scope";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { StagePillSelect } from "@/components/shared/stage-pill-select";
import { UserAvatar } from "@/components/shared/user-avatar";
import { TaskCountBadge } from "@/components/tasks/task-count-badge";
import { PermitBadge } from "@/components/jobs/permit-badge";
import { PermitStatusPill, WorkflowPhaseCell, tradesLabel, type JobWorkflowSummaryData } from "@/components/workflows/job-workflow-summary";
import { useWorkflowTemplates } from "@/components/workflows/use-workflow";
import { Briefcase, Workflow } from "lucide-react";

const ASSIGNABLE_ROLES = new Set(["ADMIN", "MANAGER", "SALES_REP"]);
const UNASSIGN_VALUE = "__unassigned";

type JobRow = {
  id: string;
  jobNumber: string;
  title: string;
  serviceType: string;
  jobType: "FIXED_PRICE" | "COST_PLUS" | "OWNED_REHAB";
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
  workflow?: JobWorkflowSummaryData | null;
};

const PERMIT_FILTER_OPTIONS = [
  { value: "UNDETERMINED", label: "Permit undetermined" },
  { value: "REQUIRED", label: "Permit required" },
  { value: "NOT_REQUIRED", label: "No permit required" },
  { value: "NONE", label: "No workflow yet" },
] as const;

const WORKFLOW_TOGGLES = [
  { key: "workflowBlocked", label: "Blocked" },
  { key: "workflowOverdue", label: "Overdue" },
  { key: "workflowUnassigned", label: "Unassigned" },
] as const;
type WorkflowToggle = (typeof WORKFLOW_TOGGLES)[number]["key"];

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
  // Workflow filters read the URL once so the dashboard widget can deep-link
  // ("3 blocked" → /jobs?workflowBlocked=1); the rest is local state.
  const initial = useSearchParams();
  const { scope, setScope, forced: scopeForced, ready: scopeReady } = useListScope();
  const { get: getUrl, setMany: setUrl } = useSearchParamState();
  const view: "table" | "board" = getUrl("view") === "board" ? "board" : "table";
  const [search, setSearch] = useState(initial.get("search") ?? "");
  const [stageId, setStageId] = useState(initial.get("stageId") ?? "");
  const [salesRepFilter, setSalesRepFilter] = useState(initial.get("salesRepId") ?? "");
  const [workflowTrade, setWorkflowTrade] = useState(initial.get("workflowTrade") ?? "");
  const [permitFilter, setPermitFilter] = useState(initial.get("permitStatus") ?? "");
  const [phaseKey, setPhaseKey] = useState(initial.get("phaseKey") ?? "");
  const [toggles, setToggles] = useState<Record<WorkflowToggle, boolean>>({
    workflowBlocked: initial.get("workflowBlocked") === "1",
    workflowOverdue: initial.get("workflowOverdue") === "1",
    workflowUnassigned: initial.get("workflowUnassigned") === "1",
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignTo, setBulkAssignTo] = useState("");
  const [bulkStage, setBulkStage] = useState("");

  const params = new URLSearchParams();
  params.set("scope", scope);
  if (search) params.set("search", search);
  if (stageId) params.set("stageId", stageId);
  if (salesRepFilter) params.set("salesRepId", salesRepFilter);
  if (workflowTrade) params.set("workflowTrade", workflowTrade);
  if (permitFilter) params.set("permitStatus", permitFilter);
  if (phaseKey) params.set("phaseKey", phaseKey);
  for (const t of WORKFLOW_TOGGLES) if (toggles[t.key]) params.set(t.key, "1");
  params.set("page", String(page));
  params.set("withTaskCounts", "true");
  params.set("withWorkflow", "true");
  const workflowFilterCount =
    Number(Boolean(workflowTrade)) + Number(Boolean(permitFilter)) + Number(Boolean(phaseKey)) + WORKFLOW_TOGGLES.filter((t) => toggles[t.key]).length;

  const {
    data,
    isLoading,
    error: jobsError,
    refetch: refetchJobs,
    isRefetching: isRefetchingJobs,
  } = useQuery<{
    data: JobRow[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: ["jobs", scope, search, stageId, salesRepFilter, workflowTrade, permitFilter, phaseKey, toggles, page],
    queryFn: () => fetchJson(`/api/jobs?${params.toString()}`),
    retry: retryServerErrors,
    enabled: scopeReady && view === "table",
  });

  const { data: stages } = useQuery<{ id: string; name: string; stageOrder: number; isClosed?: boolean; isWon?: boolean; isLost?: boolean }[]>({
    queryKey: ["jobStages"],
    queryFn: () => fetchJson("/api/jobs/stages"),
    retry: retryServerErrors,
  });

  const { data: users } = useQuery<Assignee[]>({
    queryKey: ["assignable-users"],
    queryFn: () => fetchJson("/api/users/assignable"),
    retry: retryServerErrors,
  });

  const { data: templates = [] } = useWorkflowTemplates();
  const tradeOptions = useMemo(() => templates.filter((t) => t.kind === "TRADE"), [templates]);
  const phaseOptions = useMemo(
    () =>
      [...templates]
        .sort((a, b) => (a.kind === "CORE" ? -1 : b.kind === "CORE" ? 1 : a.name.localeCompare(b.name)))
        .flatMap((t) => t.phases.map((p) => ({ key: p.key, label: `${t.name} · ${p.name}` }))),
    [templates],
  );
  const phaseLabel = (key: string) => phaseOptions.find((p) => p.key === key)?.label;

  function clearWorkflowFilters() {
    setWorkflowTrade("");
    setPermitFilter("");
    setPhaseKey("");
    setToggles({ workflowBlocked: false, workflowOverdue: false, workflowUnassigned: false });
    setPage(1);
  }

  const assignableUsers = useMemo(
    () =>
      Array.isArray(users)
        ? users.filter((u) => u.isActive && ASSIGNABLE_ROLES.has(u.role.name))
        : [],
    [users],
  );

  const changeStage = useMutation({
    mutationFn: ({ jobId, stageId }: { jobId: string; stageId: string }) =>
      fetchJson(`/api/jobs/${jobId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Stage updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignJob = useMutation({
    mutationFn: ({ jobId, salesRepId }: { jobId: string; salesRepId: string }) =>
      fetchJson(`/api/jobs/${jobId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesRepId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Sales rep updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkAssign = useMutation({
    mutationFn: () =>
      fetchJson<{ updated: number; requested: number }>(`/api/jobs/bulk-assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds: [...selected],
          salesRepId: bulkAssignTo,
        }),
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
      fetchJson<{ updated: number; requested: number }>(`/api/jobs/bulk-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds: [...selected],
          stageId: bulkStage,
        }),
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
        description={
          view === "board"
            ? `${scope === "mine" ? "Your jobs" : "All jobs"} — drag a job to move it to the next stage. Space picks a card up from the keyboard.`
            : jobsError
              ? "Jobs unavailable"
              : `${data?.total ?? 0} ${scope === "mine" ? "jobs you're on" : "active jobs"}`
        }
        actions={
          <>
          <SegmentedControl
            ariaLabel="View"
            value={view}
            onValueChange={(v) => setUrl({ view: v === "board" ? "board" : null })}
            options={[
              { value: "table", label: "Table", icon: Table2 },
              { value: "board", label: "Board", icon: KanbanSquare },
            ]}
          />
          {view === "table" && (
          <Button
            variant="outline"
            onClick={async () => {
              const exportParams = new URLSearchParams(params);
              exportParams.set("pageSize", "5000");
              exportParams.delete("page");
              exportParams.delete("withTaskCounts");
              exportParams.set("withWorkflow", "true");
              let body: { data?: JobRow[] };
              try {
                body = await fetchJson(`/api/jobs?${exportParams.toString()}`);
              } catch (e) {
                // Writing an empty CSV when the request failed reads as
                // "there is nothing to export".
                toast.error(e instanceof Error ? e.message : "Couldn't export jobs");
                return;
              }
              const rows = (body.data || []).map((j: JobRow) => ({
                jobNumber: j.jobNumber,
                address: formatAddressLine(j.lead),
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
                trades: tradesLabel(j.workflow),
                permitStatus: j.workflow?.permitStatus ?? "",
                phase: j.workflow ? (j.workflow.currentPhase?.name ?? (j.workflow.open === 0 ? "Complete" : "Waiting")) : "",
                percentComplete: j.workflow ? j.workflow.percentComplete : "",
                blockedSteps: j.workflow?.blocked ?? "",
                overdueSteps: j.workflow?.overdue ?? "",
                unassignedSteps: j.workflow?.unassigned ?? "",
              }));
              const csv = toCsv(rows, [
                { key: "jobNumber", header: "Job #" },
                { key: "address", header: "Property" },
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
                { key: "trades", header: "Trades" },
                { key: "permitStatus", header: "Permit status" },
                { key: "phase", header: "Phase" },
                { key: "percentComplete", header: "Workflow %" },
                { key: "blockedSteps", header: "Blocked steps" },
                { key: "overdueSteps", header: "Overdue steps" },
                { key: "unassignedSteps", header: "Unassigned steps" },
              ]);
              downloadCsv(`jobs-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          )}
          </>
        }
      />

      {view === "board" ? (
        <JobsBoard />
      ) : (
      <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl<ListScope>
          ariaLabel="Scope"
          size="sm"
          value={scope}
          onValueChange={(v) => {
            setScope(v);
            setPage(1);
          }}
          options={[
            { value: "mine", label: "My jobs" },
            { value: "all", label: "All", disabled: scopeForced },
          ]}
        />
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search jobs..."
            className="pl-9"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearch(e.target.value);
              setUrl({ search: e.target.value.trim() || null });
              setPage(1);
            }}
          />
        </div>
        <Select
          value={stageId}
          onValueChange={(v: string | null) => {
            const next = !v || v === "all" ? "" : v;
            setStageId(next);
            setUrl({ stageId: next || null });
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
            const next = !v || v === "all" ? "" : v;
            setSalesRepFilter(next);
            setUrl({ salesRepId: next || null });
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Anyone">
              {(v: string) => {
                if (!v) return "Anyone";
                const u = assignableUsers.find((x) => x.id === v);
                return u ? `${u.firstName} ${u.lastName}` : "Anyone";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Anyone</SelectItem>
            {assignableUsers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Workflow filters">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Workflow className="size-3.5" /> Workflow
        </span>
        <Select
          value={workflowTrade}
          onValueChange={(v: string | null) => {
            setWorkflowTrade(!v || v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue placeholder="Any trade">
              {(v: string) => (!v ? "Any trade" : tradeOptions.find((t) => t.key === v)?.name ?? "Any trade")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any trade</SelectItem>
            {tradeOptions.map((t) => (
              <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={permitFilter}
          onValueChange={(v: string | null) => {
            setPermitFilter(!v || v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-[190px] text-xs">
            <SelectValue placeholder="Any permit status">
              {(v: string) => (!v ? "Any permit status" : PERMIT_FILTER_OPTIONS.find((o) => o.value === v)?.label ?? "Any permit status")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any permit status</SelectItem>
            {PERMIT_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={phaseKey}
          onValueChange={(v: string | null) => {
            setPhaseKey(!v || v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-[230px] text-xs">
            <SelectValue placeholder="Any phase">
              {(v: string) => (!v ? "Any phase" : phaseLabel(v) ?? v)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any phase</SelectItem>
            {phaseOptions.map((p) => (
              <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {WORKFLOW_TOGGLES.map((t) => (
          <Button
            key={t.key}
            type="button"
            size="sm"
            variant={toggles[t.key] ? "secondary" : "outline"}
            aria-pressed={toggles[t.key]}
            className="h-8 text-xs"
            onClick={() => {
              setToggles((prev) => ({ ...prev, [t.key]: !prev[t.key] }));
              setPage(1);
            }}
          >
            {t.label}
          </Button>
        ))}
        {workflowFilterCount > 0 && (
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={clearWorkflowFilters}>
            <X className="mr-1 size-3" /> Clear ({workflowFilterCount})
          </Button>
        )}
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

      <div className="rounded-lg border bg-white">
        <Table containerClassName="max-h-[calc(100dvh-16rem)]">
          <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
            <TableRow>
              <TableHead className="w-8">
                <Checkbox checked={allSelected} onCheckedChange={() => toggleAll()} aria-label="Select all on page" />
              </TableHead>
              <TableHead>Property</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden md:table-cell">Service</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="hidden md:table-cell">Phase</TableHead>
              <TableHead className="text-right">Contract</TableHead>
              <TableHead className="hidden md:table-cell">Deposit</TableHead>
              <TableHead className="hidden md:table-cell">Permit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="hidden md:table-cell">Next Action</TableHead>
              <TableHead className="hidden md:table-cell">Rep</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={12} className="py-2">
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : jobsError ? (
              // "No jobs found" for a failed request made the connection
              // exhaustion outage look like every job had been deleted.
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center">
                  <p className="font-medium">Couldn&apos;t load jobs</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {jobsError instanceof Error
                      ? jobsError.message
                      : "Something went wrong loading jobs."}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => refetchJobs()}
                    disabled={isRefetchingJobs}
                  >
                    {isRefetchingJobs ? "Retrying..." : "Try again"}
                  </Button>
                </TableCell>
              </TableRow>
            ) : !data?.data?.length ? (
              <TableRow>
                <TableCell colSpan={12}>
                  <EmptyState icon={Briefcase} title="No jobs match" description="Try clearing a filter, or win a lead to start a job." />
                </TableCell>
              </TableRow>
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
                    className={`h-12 cursor-pointer hover:bg-gray-50 ${
                      selected.has(job.id) ? "bg-brand-soft/60" : ""
                    }`}
                    onClick={() => router.push(`/jobs/${job.id}`)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(job.id)}
                        onCheckedChange={() => toggleRow(job.id)}
                        aria-label={`Select ${jobLabel(job).primary}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-64">
                      <JobRef job={job} href={null} customer={false} trade={false} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{job.lead.fullName}</div>
                        </div>
                        <TaskCountBadge open={taskCount} overdue={overdueTasks} compact />
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="hidden md:table-cell text-xs">{job.serviceType}</Badge></TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <StagePillSelect
                        value={job.currentStageId}
                        stages={stages ?? []}
                        onChange={(stageId) => changeStage.mutate({ jobId: job.id, stageId })}
                      />
                    </TableCell>
                    <TableCell className="hidden md:table-cell max-w-[200px]">
                      <WorkflowPhaseCell jobId={job.id} summary={job.workflow} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <div>${Number(job.contractAmount).toLocaleString()}</div>
                      {job.jobType === "COST_PLUS" && (
                        <div className="text-[10px] font-normal text-muted-foreground">Cost+</div>
                      )}
                      {job.jobType === "OWNED_REHAB" && (
                        <div className="text-[10px] font-normal text-muted-foreground">Owned</div>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <Progress
                          value={depositPct}
                          className="h-1.5 w-16"
                          indicatorClassName={depositPct >= 100 ? "bg-tone-success" : "bg-tone-warning"}
                          label={`Deposit ${depositPct}%`}
                        />
                        <span className="text-xs tabular-nums text-muted-foreground">{depositPct}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-col items-start gap-0.5">
                        {job.workflow && <PermitStatusPill status={job.workflow.permitStatus} compact />}
                        {(hasPermit || !job.workflow) && <PermitBadge status={hasPermit ? permitStatus : null} />}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={Number(job.balanceDue) > 0 ? "font-medium" : "text-tone-success-fg"}>
                        ${Number(job.balanceDue).toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {job.nextAction ? (
                        <span className="inline-block max-w-[220px] truncate rounded-md bg-tone-warning-soft px-2 py-0.5 text-xs text-tone-warning-fg" title={job.nextAction}>{job.nextAction}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={job.salesRep?.id ?? UNASSIGN_VALUE}
                        onValueChange={(v: string | null) => {
                          if (!v || v === UNASSIGN_VALUE) return;
                          if (v !== job.salesRep?.id) {
                            assignJob.mutate({ jobId: job.id, salesRepId: v });
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 w-[160px] text-xs">
                          <SelectValue>
                            {(v: string) => {
                              const u = (!v || v === UNASSIGN_VALUE) ? null : (assignableUsers.find((x) => x.id === v) ?? job.salesRep);
                              return (
                                <span className="flex items-center gap-1.5 truncate">
                                  <UserAvatar user={u ?? null} size="xs" />
                                  {u ? `${u.firstName} ${u.lastName[0]}.` : "Unassigned"}
                                </span>
                              );
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
      </>
      )}
    </div>
  );
}
