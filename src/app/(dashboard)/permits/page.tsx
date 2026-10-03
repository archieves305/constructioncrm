"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { jobLabel } from "@/lib/labels/job";
import { formatAddressLine } from "@/lib/labels/address";
import { JobRef } from "@/components/shared/entity-label";
import { useMemo, useState } from "react";
import Link from "next/link";
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
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { AlertTriangle, Download, ExternalLink } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { PermitEditor } from "@/components/permits/permit-editor";
import { PermitInspections } from "@/components/permits/permit-inspections";
import {
  expiryNotice,
  formatDay,
  formatWhen,
  jobPermitsKey,
  PERMIT_STATUS_LABEL,
  PERMIT_STATUS_OPTIONS,
  PERMIT_STATUS_TONE,
  RESULT_LABEL,
  RESULT_TONE,
  typeLabel,
  type AssignableUser as User,
  type JobPermitsData,
  type PermitInspection,
} from "@/components/permits/shared";
import type { JobLabelInput } from "@/lib/labels/job";

const BOARD_STATUSES = PERMIT_STATUS_OPTIONS;

const statusPill = (status: string) => cn("rounded-full px-2 py-0.5 text-xs font-medium", toneClasses(PERMIT_STATUS_TONE[status] ?? "neutral").pill);
const TABS = ["board", "list", "inspections", "aging"];

type PermitRow = {
  id: string;
  jobId: string;
  municipality: string;
  permitType: string | null;
  permitNumber: string | null;
  status: string;
  submittedDate: string | null;
  expectedApprovalDate: string | null;
  approvedDate: string | null;
  expirationDate: string | null;
  finalPassedDate: string | null;
  permitFee: string | null;
  inspectorName: string | null;
  notes: string | null;
  agingDays: number | null;
  assignedUserId: string | null;
  job: {
    id: string;
    jobNumber: string;
    title: string;
    lead: { fullName: string; propertyAddress1: string; city: string; county: string | null };
  };
  assignedTo: User | null;
};

export default function PermitCenterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  // The view and filters live in the URL, so a reload or a shared link keeps them.
  const { get: getUrl, setMany: setUrl } = useSearchParamState();
  const tab = TABS.includes(getUrl("tab") ?? "") ? (getUrl("tab") as string) : "board";
  const setTab = (v: string | null) => setUrl({ tab: v && v !== "board" ? v : null });
  const filterStatus = getUrl("status") ?? "";
  const setFilterStatus = (v: string) => setUrl({ status: v || null });
  const filterMuni = getUrl("jurisdiction") ?? "";
  const setFilterMuni = (v: string) => setUrl({ jurisdiction: v || null });
  const filterCoordinator = getUrl("coordinator") ?? "";
  const setFilterCoordinator = (v: string) => setUrl({ coordinator: v || null });
  const [selectedPermitId, setSelectedPermitId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (filterStatus) params.set("status", filterStatus);
  if (filterMuni) params.set("municipality", filterMuni);
  if (filterCoordinator) params.set("assignedUserId", filterCoordinator);
  if (tab === "aging") params.set("aging", "true");

  const { data: permits, isLoading } = useQuery({
    // The Aging tab is its own question to the server; the other tabs share one list.
    queryKey: ["permits", tab === "aging", filterStatus, filterMuni, filterCoordinator],
    queryFn: () => fetchJson(`/api/permits?${params.toString()}`),
    retry: retryServerErrors,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["assignable-users"],
    queryFn: () => fetchJson("/api/users/assignable"),
  });

  // Quick changes from a board card; a failure says so instead of "Permit updated".
  const updatePermit = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      fetchJson(`/api/permits/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["permits"] });
      qc.invalidateQueries({ queryKey: ["job"] });
      toast.success("Permit updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allPermits: PermitRow[] = permits || [];
  const municipalities = useMemo(
    () => [...new Set(allPermits.map((p) => p.municipality))].sort(),
    [allPermits],
  );
  const selectedPermit = selectedPermitId
    ? allPermits.find((p) => p.id === selectedPermitId) ?? null
    : null;

  return (
    <div>
      <PageHeader
        title="Permit Center"
        description={`${allPermits.length} permits tracked`}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              const rows = allPermits.map((p) => ({
                jobNumber: p.job.jobNumber,
                customer: p.job.lead.fullName,
                address: formatAddressLine(p.job.lead),
                municipality: p.municipality,
                permitType: p.permitType ?? "",
                permitNumber: p.permitNumber ?? "",
                status: p.status,
                submittedDate: p.submittedDate ?? "",
                approvedDate: p.approvedDate ?? "",
                finalPassedDate: p.finalPassedDate ?? "",
                expirationDate: p.expirationDate ?? "",
                agingDays: p.agingDays ?? "",
                inspector: p.inspectorName ?? "",
                fee: p.permitFee ?? "",
                assignedTo: p.assignedTo
                  ? `${p.assignedTo.firstName} ${p.assignedTo.lastName}`
                  : "",
              }));
              const csv = toCsv(rows, [
                { key: "jobNumber", header: "Job #" },
                { key: "customer", header: "Customer" },
                { key: "address", header: "Address" },
                { key: "municipality", header: "Jurisdiction" },
                { key: "permitType", header: "Type" },
                { key: "permitNumber", header: "Permit #" },
                { key: "status", header: "Status" },
                { key: "submittedDate", header: "Submitted" },
                { key: "approvedDate", header: "Issued" },
                { key: "finalPassedDate", header: "Final passed" },
                { key: "expirationDate", header: "Expires" },
                { key: "agingDays", header: "Aging (days)" },
                { key: "inspector", header: "Inspector" },
                { key: "fee", header: "Fee" },
                { key: "assignedTo", header: "Coordinator" },
              ]);
              downloadCsv(`permits-${new Date().toISOString().slice(0, 10)}.csv`, csv);
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={filterCoordinator} onValueChange={(v: string | null) => setFilterCoordinator(!v || v === "all" ? "" : v)}>
          <SelectTrigger className="w-[200px]" aria-label="Coordinator"><SelectValue placeholder="Anyone" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Anyone</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterMuni} onValueChange={(v: string | null) => setFilterMuni(!v || v === "all" ? "" : v)}>
          <SelectTrigger className="w-[200px]" aria-label="Jurisdiction"><SelectValue placeholder="Any jurisdiction" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any jurisdiction</SelectItem>
            {municipalities.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v ? String(v) : null)}>
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="list">List View</TabsTrigger>
          <TabsTrigger value="inspections">Inspections</TabsTrigger>
          <TabsTrigger value="aging">Aging Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          <div className="flex gap-3 overflow-x-auto pb-4">
            {BOARD_STATUSES.map((status) => {
              const statusPermits = allPermits.filter((p) => p.status === status);
              return (
                <div key={status} className="flex-shrink-0 w-[300px] rounded-lg border bg-gray-50">
                  <div className="flex items-center justify-between border-b bg-white px-3 py-2 rounded-t-lg">
                    <span className={statusPill(status)}>{PERMIT_STATUS_LABEL[status]}</span>
                    <Badge variant="secondary" className="text-[10px]">{statusPermits.length}</Badge>
                  </div>
                  <ScrollArea className="h-[calc(100vh-300px)]">
                    <div className="space-y-2 p-2">
                      {statusPermits.map((p) => (
                        <Card
                          key={p.id}
                          className="cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => setSelectedPermitId(p.id)}
                        >
                          <CardContent className="p-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="truncate text-xs font-medium" title={p.job.jobNumber}>{jobLabel(p.job, { customer: false, trade: false }).primary}</span>
                              {p.agingDays !== null && p.agingDays > 14 && (
                                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                              )}
                            </div>
                            <p className="text-xs font-medium">{p.job.lead.fullName}</p>
                            <p className="text-[10px] text-muted-foreground">{p.municipality}</p>
                            {(() => {
                              const notice = expiryNotice(p);
                              return notice ? <span className={cn("inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium", toneClasses(notice.tone).pill)}>{notice.text}</span> : null;
                            })()}
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground truncate">
                                {p.permitType || "General"}
                              </span>
                              {p.agingDays !== null && (
                                <span className={`text-[10px] ${p.agingDays > 14 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                                  {p.agingDays}d
                                </span>
                              )}
                            </div>
                            <div onClick={(e) => e.stopPropagation()} className="space-y-1">
                              <Select
                                value={p.status}
                                onValueChange={(v: string | null) => v && updatePermit.mutate({ id: p.id, status: v })}
                              >
                                <SelectTrigger className="h-6 text-[10px]" aria-label="Status"><SelectValue>{(v: string) => PERMIT_STATUS_LABEL[v] ?? v}</SelectValue></SelectTrigger>
                                <SelectContent>
                                  {BOARD_STATUSES.map((s) => (
                                    <SelectItem key={s} value={s}>{PERMIT_STATUS_LABEL[s]}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={p.assignedUserId ?? "unassigned"}
                                onValueChange={(v: string | null) =>
                                  v && updatePermit.mutate({ id: p.id, assignedUserId: v === "unassigned" ? null : v })
                                }
                              >
                                <SelectTrigger className="h-6 text-[10px]" aria-label="Coordinator">
                                  {/* The name, not the id: the person may not be in the assignable list any more. */}
                                  <SelectValue>{() => (p.assignedTo ? `${p.assignedTo.firstName} ${p.assignedTo.lastName}` : "Unassigned")}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unassigned">Unassigned</SelectItem>
                                  {users.map((u) => (
                                    <SelectItem key={u.id} value={u.id}>
                                      {u.firstName} {u.lastName}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
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
                {BOARD_STATUSES.map((s) => <SelectItem key={s} value={s}>{PERMIT_STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Aging</TableHead>
                  <TableHead>Coordinator</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allPermits.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => setSelectedPermitId(p.id)}
                  >
                    <TableCell className="max-w-56"><JobRef job={p.job} href={null} customer={false} trade={false} /></TableCell>
                    <TableCell className="text-sm">{p.job.lead.fullName}</TableCell>
                    <TableCell className="text-sm">{p.municipality}</TableCell>
                    <TableCell className="text-sm">{p.permitType || "—"}</TableCell>
                    <TableCell>
                      <span className={statusPill(p.status)}>{PERMIT_STATUS_LABEL[p.status] ?? p.status}</span>
                    </TableCell>
                    <TableCell className="text-xs">{formatDay(p.submittedDate)}</TableCell>
                    <TableCell className="text-xs">{formatDay(p.expirationDate)}</TableCell>
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

        <TabsContent value="inspections" className="mt-4">
          <InspectionsTab />
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
                <ListSkeleton rows={6} />
              ) : allPermits.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No aging permits</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Jurisdiction</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Coordinator</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allPermits.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="max-w-56"><JobRef job={p.job} href={null} customer={false} trade={false} /></TableCell>
                        <TableCell>{p.job.lead.fullName}</TableCell>
                        <TableCell>{p.municipality}</TableCell>
                        <TableCell className="text-red-600 font-medium">{p.agingDays}d</TableCell>
                        <TableCell><span className={statusPill(p.status)}>{PERMIT_STATUS_LABEL[p.status] ?? p.status}</span></TableCell>
                        <TableCell className="text-sm">
                          {p.assignedTo ? `${p.assignedTo.firstName} ${p.assignedTo.lastName}` : "—"}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => setSelectedPermitId(p.id)}>
                            Open
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

      <PermitDetailDrawer
        permit={selectedPermit}
        users={users}
        onClose={() => setSelectedPermitId(null)}
        onOpenJob={(jobId) => router.push(`/jobs/${jobId}`)}
      />
    </div>
  );
}

function PermitDetailDrawer({
  permit, users, onClose, onOpenJob,
}: {
  permit: PermitRow | null;
  users: User[];
  onClose: () => void;
  onOpenJob: (jobId: string) => void;
}) {
  // The job's own permits read: the same record, inspections and open workflow steps the job's Permits tab shows.
  const { data, error } = useQuery<JobPermitsData>({
    queryKey: jobPermitsKey(permit?.jobId ?? ""),
    queryFn: () => fetchJson(`/api/jobs/${permit?.jobId}/permits`),
    enabled: Boolean(permit),
  });
  if (!permit) {
    return <Sheet open={false} onOpenChange={() => onClose()}><SheetContent /></Sheet>;
  }
  const record = data?.permits.find((p) => p.id === permit.id);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="border-b">
          <SheetTitle>
            Permit · {permit.permitType || "General"}
            {permit.permitNumber && <span className="ml-2 font-mono text-xs text-muted-foreground">#{permit.permitNumber}</span>}
          </SheetTitle>
          <div className="text-xs text-muted-foreground">
            Job{" "}
            <button
              className="underline-offset-2 hover:underline"
              onClick={() => onOpenJob(permit.job.id)}
            >
              {jobLabel(permit.job, { customer: false, trade: false }).primary}
            </button>
            {" · "}{permit.job.lead.fullName}{" · "}<span className="font-mono text-xs">{permit.job.jobNumber}</span>
          </div>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {error ? (
            <Callout tone="danger" title="The permit did not load">{(error as Error).message}</Callout>
          ) : !record || !data ? (
            <ListSkeleton rows={6} />
          ) : (
            <>
              {/* Keyed by the permit so an unsaved draft never carries over to the next one opened. */}
              <PermitEditor key={record.id} permit={record} users={users} canEdit={data.canEdit} />
              <div className="border-t pt-4">
                <PermitInspections jobId={record.jobId} permitId={record.id} inspections={record.inspections ?? []} steps={data.steps} canEdit={data.canEdit} />
              </div>
            </>
          )}

          {permit.agingDays !== null && permit.agingDays > 7 && (permit.status === "APPLIED" || permit.status === "IN_PROGRESS") && (
            <Callout tone="warning">
              This permit has been open for <strong>{permit.agingDays} days</strong>.{" "}
              {permit.agingDays > 14 && "Consider escalating to the municipality."}
            </Callout>
          )}
        </div>

        <div className="sticky bottom-0 z-10 mt-auto flex items-center justify-between border-t bg-white px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenJob(permit.job.id)}>
            <ExternalLink className="mr-1 h-3 w-3" />
            Open job
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type InspectionListRow = PermitInspection & {
  permit: { id: string; permitType: string | null; permitNumber: string | null; municipality: string; job: JobLabelInput & { id: string } };
};

/** Every booked permit inspection across jobs, soonest first, then the last 30 days of results. */
function InspectionsTab() {
  const { data = [], isLoading, error } = useQuery<InspectionListRow[]>({
    queryKey: ["inspections-list"],
    queryFn: () => fetchJson("/api/inspections"),
    retry: retryServerErrors,
  });
  if (isLoading) return <ListSkeleton rows={6} />;
  if (error) return <Callout tone="danger" title="The inspections did not load">{(error as Error).message}</Callout>;
  // Undated bookings last: they still need a date from the building department.
  const upcoming = data.filter((i) => i.result === "SCHEDULED").sort((a, b) => (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999"));
  const recent = data.filter((i) => i.result !== "SCHEDULED").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  if (data.length === 0) return <EmptyState icon={AlertTriangle} title="No inspections booked" description="Schedule one from a permit — on the job's Permits tab, or by opening a permit here." />;

  const table = (rows: InspectionListRow[], when: (i: InspectionListRow) => string) => (
    <div className="rounded-md border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Inspection</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Job</TableHead>
            <TableHead>Permit</TableHead>
            <TableHead>Inspector</TableHead>
            <TableHead>Workflow step</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="whitespace-nowrap text-sm">{when(i)}</TableCell>
              <TableCell className="text-sm font-medium">
                <Link href={`/jobs/${i.permit.job.id}?tab=permits`} className="hover:underline">{typeLabel(i.type)}</Link>
              </TableCell>
              <TableCell>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", toneClasses(RESULT_TONE[i.result] ?? "neutral").pill)}>{RESULT_LABEL[i.result] ?? i.result}</span>
              </TableCell>
              <TableCell className="max-w-56"><JobRef job={i.permit.job} href={`/jobs/${i.permit.job.id}?tab=permits`} customer={false} trade={false} /></TableCell>
              <TableCell className="text-sm">
                {i.permit.permitType || "Permit"} · {i.permit.municipality}
                {i.permit.permitNumber ? <span className="ml-1 font-mono text-xs text-muted-foreground">#{i.permit.permitNumber}</span> : null}
              </TableCell>
              <TableCell className="text-sm">{i.inspectorName || "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{i.task?.title ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Upcoming ({upcoming.length})</h2>
        {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is booked.</p> : table(upcoming, (i) => formatWhen(i.scheduledFor))}
      </section>
      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Results in the last 30 days ({recent.length})</h2>
          {table(recent, (i) => formatDay(i.completedAt))}
        </section>
      )}
    </div>
  );
}
