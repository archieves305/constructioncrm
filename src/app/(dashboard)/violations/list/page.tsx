"use client";

import { Suspense, useMemo, useState } from "react";
import { jobText } from "@/lib/labels/job";
import Link from "next/link";
import { format } from "date-fns";
import { Download, Gavel, Plus, Search, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { useSession } from "@/lib/auth/session-client";
import { toCsv, downloadCsv } from "@/lib/csv";
import { canAssignCase, canCreateCase, canExportCases } from "@/lib/violations/access";
import { VIOLATION_FLAGS, VIOLATION_VIEWS, type ViolationFlag, type ViolationView } from "@/lib/violations/query";
import { cn } from "@/lib/utils";
import { CaseFlags, CaseNumberLink, CasePhaseCell, CaseStatusPill, DeadlineCell, addressOf } from "@/components/violations/case-widgets";
import { CASE_STATUS_LABEL } from "@/components/violations/status";
import { money, useBulkAssignCases, useViolationCases, useViolationCategories, useViolationSummary, type CaseRow } from "@/components/violations/use-violations";

const VIEW_LABEL: Record<ViolationView, string> = { all: "All open", mine: "Mine", new: "New", "due-soon": "Due soon", overdue: "Overdue", fines: "Fines & liens", "awaiting-agency": "Awaiting agency", closed: "Closed" };
const FLAG_LABEL: Record<ViolationFlag, string> = { finesAccruing: "Fines accruing", lienRecorded: "Lien", hearingScheduled: "Hearing scheduled", permitPending: "Permit pending", emergency: "Emergency", constructionRequired: "Construction", blocked: "Blocked" };
const EMPTY: Record<ViolationView, string> = {
  all: "No open cases. Create one from a notice.",
  mine: "Nothing assigned to you.",
  new: "No new cases waiting for review.",
  "due-soon": "Nothing due in the next week.",
  overdue: "Nothing overdue.",
  fines: "No case has fines accruing, an official balance or a recorded lien.",
  "awaiting-agency": "No reinspection is waiting on the agency.",
  closed: "No closed cases yet.",
};

export default function ViolationsListPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ListBody />
    </Suspense>
  );
}

function ListBody() {
  const { get, setMany } = useSearchParamState();
  const { data: session } = useSession();
  const role = session?.user.role;
  const viewRaw = get("view") ?? "all";
  const view = (VIOLATION_VIEWS as readonly string[]).includes(viewRaw) ? (viewRaw as ViolationView) : "all";
  const params = useMemo(() => {
    const p: Record<string, string | undefined> = { view, pageSize: "100" };
    for (const k of ["search", "jurisdiction", "categoryId", "caseManagerId", "status", "phaseKey", "page"]) {
      const v = get(k);
      if (v) p[k] = v;
    }
    for (const f of VIOLATION_FLAGS) if (get(f) === "1") p[f] = "1";
    return p;
  }, [get, view]);
  const { data, isLoading, error, refetch } = useViolationCases(params);
  const { data: summary } = useViolationSummary();
  const { data: categories = [] } = useViolationCategories();
  const { data: users = [] } = useAssignableUsers();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const bulk = useBulkAssignCases();
  const rows = data?.data ?? [];
  const canAssign = role ? canAssignCase(role) : false;
  const canExport = role ? canExportCases(role) : false;
  const canCreate = role ? canCreateCase(role) : false;
  const [search, setSearch] = useState(get("search") ?? "");

  const exportCsv = () => {
    const csv = toCsv(
      rows.map((r) => ({
        caseNumber: r.caseNumber,
        agencyCaseNumber: r.agencyCaseNumber ?? "",
        title: r.title,
        property: addressOf(r.lead),
        owner: r.lead.fullName,
        jurisdiction: r.jurisdiction ?? "",
        status: CASE_STATUS_LABEL[r.status] ?? r.status,
        state: r.state.label,
        phase: r.workflow?.summary?.currentPhase?.name ?? "",
        progress: r.workflow?.summary ? `${r.workflow.summary.percentComplete}%` : "",
        deadline: r.currentDeadline ? format(new Date(r.currentDeadline), "yyyy-MM-dd") : "",
        daysRemaining: r.state.deadlineInDays ?? "",
        categories: r.items.map((i) => i.category?.name).filter(Boolean).join("; "),
        items: r.items.length,
        estimate: r.fines.systemEstimate,
        official: r.fines.officialBalance?.amount ?? "",
        exposure: r.fines.exposure,
        lien: r.lienStatus,
        nextAction: r.nextAction?.title ?? "",
        caseManager: r.caseManager ? `${r.caseManager.firstName} ${r.caseManager.lastName}` : "",
        job: r.job ? jobText(r.job) : "",
        flags: r.state.flags.join(" "),
      })),
      [
        { key: "caseNumber", header: "Case" },
        { key: "agencyCaseNumber", header: "Agency #" },
        { key: "title", header: "Title" },
        { key: "property", header: "Property" },
        { key: "owner", header: "Owner / lead" },
        { key: "jurisdiction", header: "Jurisdiction" },
        { key: "status", header: "Status" },
        { key: "state", header: "State" },
        { key: "phase", header: "Phase" },
        { key: "progress", header: "Progress" },
        { key: "deadline", header: "Deadline" },
        { key: "daysRemaining", header: "Days remaining" },
        { key: "categories", header: "Categories" },
        { key: "items", header: "Items" },
        { key: "estimate", header: "Fine estimate" },
        { key: "official", header: "Official balance" },
        { key: "exposure", header: "Exposure" },
        { key: "lien", header: "Lien" },
        { key: "nextAction", header: "Next action" },
        { key: "caseManager", header: "Case manager" },
        { key: "job", header: "Job" },
        { key: "flags", header: "Flags" },
      ],
    );
    downloadCsv(`violations-${format(new Date(), "yyyy-MM-dd")}.csv`, csv);
  };

  const pill = (label: string, n: number | undefined, v: ViolationView, tone?: "danger" | "warning") => (
    <button type="button" onClick={() => setMany({ view: v, page: null })} className={cn("rounded-full border px-2.5 py-0.5 text-xs", view === v ? "border-brand bg-brand-soft text-brand-fg" : "hover:bg-gray-50", tone === "danger" && (n ?? 0) > 0 && view !== v && "border-red-200 bg-red-50 text-red-700", tone === "warning" && (n ?? 0) > 0 && view !== v && "border-amber-200 bg-amber-50 text-amber-800")}>
      {label} {n ?? "…"}
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Code violation cases"
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {pill("Mine", summary?.mine, "mine")}
            {pill("Overdue", summary?.overdue, "overdue", "danger")}
            {pill("Due soon", summary?.dueSoon, "due-soon", "warning")}
            {pill("Awaiting agency", summary?.awaitingAgency, "awaiting-agency")}
          </span>
        }
        actions={
          <div className="flex gap-2">
            {canExport && (
              <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
                <Download className="size-4" /> CSV
              </Button>
            )}
            {canCreate && (
              <Button variant="brand" nativeButton={false} render={<Link href="/violations/new" />}>
                <Plus className="size-4" /> New case
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <SegmentedControl ariaLabel="Queue" size="sm" value={view} onValueChange={(v) => setMany({ view: v, page: null })} options={VIOLATION_VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v] }))} />
      </div>
      <div className="mb-4 grid gap-2 rounded-lg border bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <Label className="text-xs">Search</Label>
          <form
            className="relative mt-1"
            onSubmit={(e) => {
              e.preventDefault();
              setMany({ search: search.trim() || null, page: null });
            }}
          >
            <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Case #, agency #, address, owner, officer…" />
          </form>
        </div>
        <div>
          <Label className="text-xs">Jurisdiction</Label>
          <Select value={get("jurisdiction") ?? "__all"} onValueChange={(v: string | null) => setMany({ jurisdiction: !v || v === "__all" ? null : v, page: null })}>
            <SelectTrigger className="mt-1">
              <SelectValue>{(v: string) => (!v || v === "__all" ? "All" : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All</SelectItem>
              {(summary?.jurisdictions ?? []).map((j) => (
                <SelectItem key={j} value={j}>
                  {j}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Category</Label>
          <Select value={get("categoryId") ?? "__all"} onValueChange={(v: string | null) => setMany({ categoryId: !v || v === "__all" ? null : v, page: null })}>
            <SelectTrigger className="mt-1">
              <SelectValue>{(v: string) => (!v || v === "__all" ? "All" : (categories.find((c) => c.id === v)?.name ?? "—"))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Case manager</Label>
          <Select value={get("caseManagerId") ?? "__all"} onValueChange={(v: string | null) => setMany({ caseManagerId: !v || v === "__all" ? null : v, page: null })}>
            <SelectTrigger className="mt-1">
              <SelectValue>
                {(v: string) => {
                  if (!v || v === "__all") return "All";
                  if (v === "__unassigned") return "Unassigned";
                  const u = users.find((x) => x.id === v);
                  return u ? `${u.firstName} ${u.lastName}` : "—";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All</SelectItem>
              <SelectItem value="__unassigned">Unassigned</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={get("status") ?? "__all"} onValueChange={(v: string | null) => setMany({ status: !v || v === "__all" ? null : v, page: null })}>
            <SelectTrigger className="mt-1">
              <SelectValue>{(v: string) => (!v || v === "__all" ? "Any" : (CASE_STATUS_LABEL[v] ?? v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Any</SelectItem>
              {Object.entries(CASE_STATUS_LABEL).map(([k, l]) => (
                <SelectItem key={k} value={k}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 lg:col-span-6">
          {VIOLATION_FLAGS.map((f) => {
            const on = get(f) === "1";
            return (
              <button key={f} type="button" onClick={() => setMany({ [f]: on ? null : "1", page: null })} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-brand bg-brand-soft text-brand-fg" : "hover:bg-gray-50")}>
                {FLAG_LABEL[f]}
              </button>
            );
          })}
          {(get("search") || get("jurisdiction") || get("categoryId") || get("caseManagerId") || get("status") || VIOLATION_FLAGS.some((f) => get(f) === "1")) && (
            <button type="button" className="ml-auto text-xs underline" onClick={() => { setSearch(""); setMany({ search: null, jurisdiction: null, categoryId: null, caseManagerId: null, status: null, phaseKey: null, page: null, ...Object.fromEntries(VIOLATION_FLAGS.map((f) => [f, null])) }); }}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {canAssign && selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-sm">
          <UserCheck className="size-4" />
          {selected.size} selected
          <AssigneePicker className="w-56" size="sm" value={assignTo} users={users} onChange={setAssignTo} placeholder="Reassign to…" />
          <Button size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ caseIds: Array.from(selected), caseManagerId: assignTo }, { onSuccess: () => setSelected(new Set()) })}>
            {assignTo ? "Assign" : "Unassign"}
          </Button>
          <button type="button" className="ml-auto text-xs underline" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {error ? (
        <Callout tone="danger" title="Couldn't load the cases" action={<Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>}>
          {error instanceof Error ? error.message : "Something went wrong."}
        </Callout>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Gavel} title={EMPTY[view]} action={canCreate && view === "all" ? <Button variant="brand" nativeButton={false} render={<Link href="/violations/new" />}>New case</Button> : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <Table>
            <TableHeader className="sticky top-0 bg-white">
              <TableRow>
                {canAssign && (
                  <TableHead className="w-8">
                    <Checkbox checked={selected.size > 0 && selected.size === rows.length} onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Select all" />
                  </TableHead>
                )}
                <TableHead>Case</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="text-right">Est. / official</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead>Manager</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <Row key={r.id} r={r} selectable={canAssign} selected={selected.has(r.id)} onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n; })} />
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>
              {data?.total ?? rows.length} case{(data?.total ?? rows.length) === 1 ? "" : "s"}
            </span>
            {(data?.totalPages ?? 1) > 1 && (
              <span className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={(data?.page ?? 1) <= 1} onClick={() => setMany({ page: String((data?.page ?? 1) - 1) })}>
                  Previous
                </Button>
                Page {data?.page} of {data?.totalPages}
                <Button size="sm" variant="outline" disabled={(data?.page ?? 1) >= (data?.totalPages ?? 1)} onClick={() => setMany({ page: String((data?.page ?? 1) + 1) })}>
                  Next
                </Button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ r, selectable, selected, onSelect }: { r: CaseRow; selectable: boolean; selected: boolean; onSelect: (v: boolean) => void }) {
  const cats = Array.from(new Set(r.items.map((i) => i.category?.name).filter(Boolean))) as string[];
  const openItems = r.items.filter((i) => i.status !== "VERIFIED" && i.status !== "WITHDRAWN").length;
  return (
    <TableRow className={cn(r.state.overdue && "bg-red-50/40")}>
      {selectable && (
        <TableCell>
          <Checkbox checked={selected} onCheckedChange={(v) => onSelect(Boolean(v))} aria-label={`Select ${r.caseNumber}`} />
        </TableCell>
      )}
      <TableCell>
        <CaseNumberLink id={r.id} caseNumber={r.caseNumber} />
        <div className="max-w-[220px] truncate text-xs text-muted-foreground">{r.title}</div>
      </TableCell>
      <TableCell>
        <div className="max-w-[200px] truncate text-sm">{addressOf(r.lead)}</div>
        <div className="truncate text-xs text-muted-foreground">{r.lead.fullName}</div>
      </TableCell>
      <TableCell className="text-xs">{r.jurisdiction ?? "—"}</TableCell>
      <TableCell className="text-xs">
        <span className="tabular-nums">
          {openItems}/{r.items.length}
        </span>
        {cats.length > 0 && <div className="max-w-[160px] truncate text-[11px] text-muted-foreground">{cats.join(", ")}</div>}
      </TableCell>
      <TableCell>
        <CaseStatusPill status={r.status} />
        <div className="mt-0.5 text-[11px] text-muted-foreground">{r.state.label}</div>
      </TableCell>
      <TableCell>
        <CasePhaseCell row={r} />
      </TableCell>
      <TableCell>
        <DeadlineCell at={r.currentDeadline} done={r.status === "CLOSED" || r.status === "CANCELLED" || Boolean(r.agencyConfirmedAt)} />
      </TableCell>
      <TableCell>
        <CaseFlags flags={r.state.flags} />
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        <div>{money(r.fines.systemEstimate)}</div>
        <div className="text-muted-foreground">{r.fines.officialBalance ? money(r.fines.officialBalance.amount) : "—"}</div>
      </TableCell>
      <TableCell className="max-w-[200px]">
        {r.nextAction ? (
          <Link href={`/violations/${r.id}?tab=workflow&task=${r.nextAction.id}`} className="block truncate text-xs hover:underline">
            {r.nextAction.title}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        {r.nextAction?.dueAt && <div className="text-[11px] text-muted-foreground">due {format(new Date(r.nextAction.dueAt), "MMM d")}</div>}
      </TableCell>
      <TableCell>
        <UserAvatar user={r.caseManager} size="sm" title={r.caseManager ? `${r.caseManager.firstName} ${r.caseManager.lastName}` : "Unassigned"} />
      </TableCell>
    </TableRow>
  );
}
