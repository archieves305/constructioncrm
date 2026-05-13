"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertTriangle, Download, ExternalLink } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";

const STATUS_COLORS: Record<string, string> = {
  APPLIED: "bg-blue-100 text-blue-800",
  IN_PROGRESS: "bg-purple-100 text-purple-800",
  ISSUED: "bg-teal-100 text-teal-800",
  FINAL: "bg-green-100 text-green-800",
  EXPIRED: "bg-gray-100 text-gray-800",
  DENIED: "bg-red-100 text-red-800",
};

const BOARD_STATUSES = ["APPLIED", "IN_PROGRESS", "ISSUED", "FINAL", "DENIED"];

type User = { id: string; firstName: string; lastName: string };

type PermitRow = {
  id: string;
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

const dateInput = (s: string | null) => (s ? s.slice(0, 10) : "");

export default function PermitCenterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState("board");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterMuni, setFilterMuni] = useState("");
  const [filterCoordinator, setFilterCoordinator] = useState("");
  const [selectedPermitId, setSelectedPermitId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (filterStatus) params.set("status", filterStatus);
  if (filterMuni) params.set("municipality", filterMuni);
  if (filterCoordinator) params.set("assignedUserId", filterCoordinator);
  if (tab === "aging") params.set("aging", "true");

  const { data: permits, isLoading } = useQuery({
    queryKey: ["permits", tab, filterStatus, filterMuni, filterCoordinator],
    queryFn: () => fetch(`/api/permits?${params.toString()}`).then((r) => r.json()),
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => fetch("/api/admin/users").then((r) => r.json()),
  });

  const updatePermit = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      fetch(`/api/permits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["permits"] }); toast.success("Permit updated"); },
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
                address: `${p.job.lead.propertyAddress1}, ${p.job.lead.city}`,
                municipality: p.municipality,
                permitType: p.permitType ?? "",
                permitNumber: p.permitNumber ?? "",
                status: p.status,
                submittedDate: p.submittedDate ?? "",
                approvedDate: p.approvedDate ?? "",
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
                { key: "municipality", header: "Municipality" },
                { key: "permitType", header: "Type" },
                { key: "permitNumber", header: "Permit #" },
                { key: "status", header: "Status" },
                { key: "submittedDate", header: "Submitted" },
                { key: "approvedDate", header: "Approved" },
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
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Coordinators" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Coordinators</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
            ))}
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
                <div key={status} className="flex-shrink-0 w-[300px] rounded-lg border bg-gray-50">
                  <div className="flex items-center justify-between border-b bg-white px-3 py-2 rounded-t-lg">
                    <Badge variant="outline" className={`text-xs border-0 ${STATUS_COLORS[status] || ""}`}>
                      {status.replace("_", " ")}
                    </Badge>
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
                              <span className="text-xs font-mono">{p.job.jobNumber}</span>
                              {p.agingDays !== null && p.agingDays > 14 && (
                                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                              )}
                            </div>
                            <p className="text-xs font-medium">{p.job.lead.fullName}</p>
                            <p className="text-[10px] text-muted-foreground">{p.municipality}</p>
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
                                <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {BOARD_STATUSES.map((s) => (
                                    <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={p.assignedUserId ?? "unassigned"}
                                onValueChange={(v: string | null) =>
                                  v && updatePermit.mutate({ id: p.id, assignedUserId: v === "unassigned" ? null : v })
                                }
                              >
                                <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Unassigned" /></SelectTrigger>
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
                {BOARD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
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
                    <TableCell className="text-xs">{p.expirationDate ? format(new Date(p.expirationDate), "MMM d, yyyy") : "—"}</TableCell>
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
                      <TableHead>Coordinator</TableHead>
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
        onSave={(patch) => {
          if (!selectedPermit) return;
          updatePermit.mutate({ id: selectedPermit.id, ...patch });
        }}
        onOpenJob={(jobId) => router.push(`/jobs/${jobId}`)}
      />
    </div>
  );
}

function PermitDetailDrawer({
  permit, users, onClose, onSave, onOpenJob,
}: {
  permit: PermitRow | null;
  users: User[];
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  onOpenJob: (jobId: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setDraft({});
  }, [permit?.id]);

  if (!permit) {
    return <Sheet open={false} onOpenChange={() => onClose()}><SheetContent /></Sheet>;
  }

  const v = <K extends keyof PermitRow>(key: K): PermitRow[K] =>
    (draft[key as string] as PermitRow[K] | undefined) ?? permit[key];

  const setField = (key: string, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const dirty = Object.keys(draft).length > 0;

  return (
    <Sheet open={!!permit} onOpenChange={(o) => !o && onClose()}>
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
              {permit.job.jobNumber}
            </button>
            {" · "}{permit.job.lead.fullName}{" · "}{permit.job.lead.propertyAddress1}, {permit.job.lead.city}
          </div>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-24">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Municipality">
              <Input value={String(v("municipality") ?? "")} onChange={(e) => setField("municipality", e.target.value)} />
            </Field>
            <Field label="Permit type">
              <Input value={String(v("permitType") ?? "")} onChange={(e) => setField("permitType", e.target.value)} placeholder="Re-roof, Electrical, …" />
            </Field>
            <Field label="Permit #">
              <Input value={String(v("permitNumber") ?? "")} onChange={(e) => setField("permitNumber", e.target.value)} />
            </Field>
            <Field label="Status">
              <Select
                value={String(v("status") ?? "APPLIED")}
                onValueChange={(val: string | null) => val && setField("status", val)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["APPLIED", "IN_PROGRESS", "ISSUED", "FINAL", "EXPIRED", "DENIED"].map((s) => (
                    <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Submitted">
              <Input type="date" value={dateInput(v("submittedDate") as string | null)} onChange={(e) => setField("submittedDate", e.target.value || null)} />
            </Field>
            <Field label="Expected approval">
              <Input type="date" value={dateInput(v("expectedApprovalDate") as string | null)} onChange={(e) => setField("expectedApprovalDate", e.target.value || null)} />
            </Field>
            <Field label="Approved">
              <Input type="date" value={dateInput(v("approvedDate") as string | null)} onChange={(e) => setField("approvedDate", e.target.value || null)} />
            </Field>
            <Field label="Expires">
              <Input type="date" value={dateInput(v("expirationDate") as string | null)} onChange={(e) => setField("expirationDate", e.target.value || null)} />
            </Field>
            <Field label="Final passed">
              <Input type="date" value={dateInput(v("finalPassedDate") as string | null)} onChange={(e) => setField("finalPassedDate", e.target.value || null)} />
            </Field>
            <Field label="Permit fee">
              <Input value={String(v("permitFee") ?? "")} onChange={(e) => setField("permitFee", e.target.value)} placeholder="0.00" inputMode="decimal" />
            </Field>
            <Field label="Inspector">
              <Input value={String(v("inspectorName") ?? "")} onChange={(e) => setField("inspectorName", e.target.value)} />
            </Field>
            <Field label="Coordinator">
              <Select
                value={(v("assignedUserId") as string | null) ?? "unassigned"}
                onValueChange={(val: string | null) => val && setField("assignedUserId", val === "unassigned" ? null : val)}
              >
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Notes">
            <Textarea
              rows={5}
              value={String(v("notes") ?? "")}
              onChange={(e) => setField("notes", e.target.value)}
              placeholder="Inspector feedback, conditions of approval, conversations with the building department…"
            />
          </Field>

          <InspectionsPanel permitId={permit.id} />

          {permit.agingDays !== null && permit.agingDays > 7 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
              This permit has been open for <strong>{permit.agingDays} days</strong>.{" "}
              {permit.agingDays > 14 && "Consider escalating to the municipality."}
            </div>
          )}
        </div>

        <div className="fixed bottom-0 right-0 z-10 flex w-full max-w-xl items-center justify-between border-t bg-white px-4 py-3 shadow-sm">
          <Button variant="outline" size="sm" onClick={() => onOpenJob(permit.job.id)}>
            <ExternalLink className="mr-1 h-3 w-3" />
            Open job
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            <Button
              size="sm"
              disabled={!dirty}
              onClick={() => {
                onSave(draft);
                setDraft({});
              }}
            >
              Save changes
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

type Inspection = {
  id: string;
  type: string;
  scheduledFor: string | null;
  completedAt: string | null;
  result: string;
  inspectorName: string | null;
  notes: string | null;
};

const INSPECTION_TYPES = [
  "ROUGH",
  "FRAMING",
  "ELECTRICAL",
  "PLUMBING",
  "MECHANICAL",
  "ROOFING_IN_PROGRESS",
  "ROOFING_FINAL",
  "FINAL",
  "OTHER",
];

const INSPECTION_RESULTS = ["SCHEDULED", "PASS", "FAIL", "CONDITIONAL", "CANCELLED"];

const RESULT_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800",
  PASS: "bg-green-100 text-green-800",
  FAIL: "bg-red-100 text-red-800",
  CONDITIONAL: "bg-amber-100 text-amber-800",
  CANCELLED: "bg-gray-100 text-gray-800",
};

function InspectionsPanel({ permitId }: { permitId: string }) {
  const qc = useQueryClient();
  const { data: inspections = [], isLoading } = useQuery<Inspection[]>({
    queryKey: ["inspections", permitId],
    queryFn: () => fetch(`/api/permits/${permitId}/inspections`).then((r) => r.json()),
  });

  const [showAdd, setShowAdd] = useState(false);
  const blankNew = {
    type: "FINAL",
    scheduledFor: "",
    inspectorName: "",
    notes: "",
  };
  const [newInsp, setNewInsp] = useState(blankNew);

  const create = useMutation({
    mutationFn: (data: typeof blankNew) =>
      fetch(`/api/permits/${permitId}/inspections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          scheduledFor: data.scheduledFor || null,
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inspections", permitId] });
      setNewInsp(blankNew);
      setShowAdd(false);
      toast.success("Inspection scheduled");
    },
  });

  const update = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      fetch(`/api/inspections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inspections", permitId] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/inspections/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inspections", permitId] });
      toast.success("Inspection removed");
    },
  });

  return (
    <div className="space-y-2 rounded-md border bg-gray-50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Inspections</h3>
          <Badge variant="secondary" className="text-[10px]">{inspections.length}</Badge>
        </div>
        {!showAdd && (
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            Schedule
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="space-y-2 rounded border bg-white p-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-[10px]">Type</Label>
              <Select value={newInsp.type} onValueChange={(v: string | null) => v && setNewInsp({ ...newInsp, type: v })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INSPECTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Scheduled for</Label>
              <Input type="datetime-local" className="h-8" value={newInsp.scheduledFor}
                onChange={(e) => setNewInsp({ ...newInsp, scheduledFor: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[10px]">Inspector</Label>
              <Input className="h-8" value={newInsp.inspectorName}
                onChange={(e) => setNewInsp({ ...newInsp, inspectorName: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[10px]">Notes</Label>
              <Textarea rows={2} value={newInsp.notes}
                onChange={(e) => setNewInsp({ ...newInsp, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => { setShowAdd(false); setNewInsp(blankNew); }}>Cancel</Button>
            <Button size="sm" disabled={create.isPending} onClick={() => create.mutate(newInsp)}>
              Schedule inspection
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="py-2 text-center text-xs text-muted-foreground">Loading…</p>
      ) : inspections.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          No inspections yet.
        </p>
      ) : (
        <div className="space-y-2">
          {inspections.map((i) => (
            <InspectionRow
              key={i.id}
              insp={i}
              onUpdate={(patch) => update.mutate({ id: i.id, ...patch })}
              onDelete={() => {
                if (confirm("Delete this inspection?")) remove.mutate(i.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InspectionRow({
  insp,
  onUpdate,
  onDelete,
}: {
  insp: Inspection;
  onUpdate: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const scheduledLocal = insp.scheduledFor
    ? new Date(insp.scheduledFor).toISOString().slice(0, 16)
    : "";
  const completedLocal = insp.completedAt
    ? new Date(insp.completedAt).toISOString().slice(0, 16)
    : "";

  return (
    <div className="rounded border bg-white text-xs">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className={`border-0 text-[10px] ${RESULT_COLORS[insp.result] || ""}`}>
            {insp.result}
          </Badge>
          <span className="font-medium">{insp.type.replace(/_/g, " ")}</span>
          {insp.scheduledFor && (
            <span className="text-muted-foreground">
              · {format(new Date(insp.scheduledFor), "MMM d, h:mm a")}
            </span>
          )}
          {insp.inspectorName && (
            <span className="truncate text-muted-foreground">· {insp.inspectorName}</span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{expanded ? "Hide" : "Edit"}</span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t bg-gray-50 px-2 py-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-[10px]">Type</Label>
              <Select value={insp.type} onValueChange={(v: string | null) => v && onUpdate({ type: v })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INSPECTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Result</Label>
              <Select value={insp.result} onValueChange={(v: string | null) => v && onUpdate({ result: v })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INSPECTION_RESULTS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Scheduled for</Label>
              <Input
                type="datetime-local"
                className="h-7 text-xs"
                defaultValue={scheduledLocal}
                onBlur={(e) =>
                  onUpdate({ scheduledFor: e.target.value || null })
                }
              />
            </div>
            <div>
              <Label className="text-[10px]">Completed at</Label>
              <Input
                type="datetime-local"
                className="h-7 text-xs"
                defaultValue={completedLocal}
                onBlur={(e) =>
                  onUpdate({ completedAt: e.target.value || null })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[10px]">Inspector</Label>
              <Input
                className="h-7 text-xs"
                defaultValue={insp.inspectorName ?? ""}
                onBlur={(e) => onUpdate({ inspectorName: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[10px]">Notes</Label>
              <Textarea
                rows={2}
                defaultValue={insp.notes ?? ""}
                onBlur={(e) => onUpdate({ notes: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={onDelete}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
