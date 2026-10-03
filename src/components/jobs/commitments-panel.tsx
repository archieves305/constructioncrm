"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat, MoreHorizontal, PackageCheck, Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { COMMITMENT_STATUS_LABEL, commitmentCode, type CommitmentStatusName } from "@/lib/vendors/commitments";
import { ComplianceCallout, type ComplianceSummary } from "@/components/vendors/compliance-badge";
import { VendorSelect } from "@/components/vendors/vendor-select";
import { commitmentsKey, useJobCommitments, type CommitmentRow, type JobCommitments } from "@/components/vendors/use-commitments";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const NO_LINE = "__none";

const STATUS_TONE: Record<CommitmentStatusName, string> = {
  OPEN: "border-blue-200 bg-blue-50 text-blue-800",
  CLOSED: "border-gray-200 bg-gray-50 text-gray-600",
  CANCELLED: "border-gray-200 bg-gray-50 text-gray-500 line-through",
};

/**
 * What has been promised to vendors on this job and not paid yet. A
 * commitment is not a cost: only its unspent part counts, under "Committed"
 * in the cost summary above, and an expense against it moves that money to
 * "Spent". Crew labor contracts are listed for the whole picture; they are
 * managed under Field → Labor.
 */
export function CommitmentsPanel({ jobId, onOpenLabor }: { jobId: string; onOpenLabor?: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useJobCommitments(jobId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CommitmentRow | null>(null);
  const [removing, setRemoving] = useState<CommitmentRow | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: commitmentsKey(jobId) });
    qc.invalidateQueries({ queryKey: ["job", jobId, "cost-summary"] });
    qc.invalidateQueries({ queryKey: ["vendors"] });
  };

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CommitmentStatusName }) =>
      fetchJson(`/api/commitments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: (_r, v) => {
      refresh();
      toast.success(v.status === "OPEN" ? "Commitment reopened" : v.status === "CLOSED" ? "Commitment closed — what was left is released" : "Commitment cancelled");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/commitments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      setRemoving(null);
      toast.success("Commitment deleted");
    },
    onError: (e: Error) => {
      setRemoving(null);
      toast.error(e.message);
    },
  });

  if (isLoading) return <ListSkeleton rows={4} />;
  if (error || !data) {
    return <EmptyState icon={PackageCheck} title="Commitments could not be loaded" description={(error as Error | null)?.message} action={<Button variant="outline" onClick={() => refetch()}>Try again</Button>} />;
  }
  const { commitments, laborContracts, totals, canManage } = data;
  const laborOpen = laborContracts.reduce((s, c) => s + c.open, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Orders and agreements promised to a vendor and not paid yet. The open part counts as committed cost; an expense to that vendor draws it down.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 size-4" />
            Add commitment
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Open commitments" value={usd(totals.committed)} />
        <Tile label="Received on them" value={usd(totals.received)} />
        <Tile label="Still open" value={usd(totals.open)} strong />
      </div>

      {commitments.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={PackageCheck}
              title="No commitments yet"
              description="Add one when a material order is placed or a supplier's quote is accepted, so the job's projected cost includes it before the bill arrives."
              action={canManage ? <Button onClick={() => setAdding(true)}>Add commitment</Button> : undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Commitment</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Received</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {commitments.map((c) => (
                  <TableRow key={c.id} className={cn(c.status === "CANCELLED" && "opacity-60")}>
                    <TableCell className="max-w-[20rem] whitespace-normal">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] text-muted-foreground">{commitmentCode(c.number)}</span>
                        <Link href={`/vendors/${c.vendor.id}`} className="font-medium text-gray-900 hover:underline">{c.vendor.name}</Link>
                        <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", STATUS_TONE[c.status])}>{COMMITMENT_STATUS_LABEL[c.status]}</span>
                      </div>
                      <div className="break-words text-sm text-gray-700">{c.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          c.budgetLine ? `Budget: ${c.budgetLine.name}` : null,
                          new Date(c.committedDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
                          `${c.expenseCount} expense${c.expenseCount === 1 ? "" : "s"}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {c.status === "OPEN" && <ComplianceCallout compliance={c.vendorCompliance} className="mt-1.5" />}
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">{usd(c.amount)}</TableCell>
                    <TableCell className="hidden text-right align-top tabular-nums sm:table-cell">{usd(c.received)}</TableCell>
                    <TableCell className="text-right align-top font-medium tabular-nums">{c.status === "OPEN" ? usd(c.open) : "—"}</TableCell>
                    <TableCell className="align-top">
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button size="icon" variant="ghost" className="size-7" aria-label={`Actions for ${commitmentCode(c.number)}`} />}>
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditing(c)}>Edit</DropdownMenuItem>
                            {c.status === "OPEN" && <DropdownMenuItem onClick={() => setStatus.mutate({ id: c.id, status: "CLOSED" })}>Close — nothing more is coming</DropdownMenuItem>}
                            {c.status === "OPEN" && <DropdownMenuItem onClick={() => setStatus.mutate({ id: c.id, status: "CANCELLED" })}>Cancel</DropdownMenuItem>}
                            {c.status !== "OPEN" && <DropdownMenuItem onClick={() => setStatus.mutate({ id: c.id, status: "OPEN" })}>Reopen</DropdownMenuItem>}
                            {c.expenseCount === 0 && <DropdownMenuItem onClick={() => setRemoving(c)}>Delete</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {laborContracts.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium"><HardHat className="size-4 text-muted-foreground" /> Labor contracts</div>
                <p className="text-xs text-muted-foreground">Crew labor is committed when its contract is written. {usd(laborOpen)} is not yet paid.</p>
              </div>
              {onOpenLabor && <Button size="sm" variant="outline" onClick={onOpenLabor}>Manage under Field → Labor</Button>}
            </div>
            <Table>
              <TableBody>
                {laborContracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-[20rem] whitespace-normal">
                      <span className="font-medium">{c.name}</span>
                      {c.vendor && c.vendor.name !== c.name && <span className="text-xs text-muted-foreground"> · {c.vendor.name}</span>}
                      <Badge variant="outline" className="ml-2 text-[10px]">Labor contract</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd(c.amount)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{usd(c.paid)} paid</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{usd(c.open)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CommitmentDialog jobId={jobId} open={adding} onOpenChange={setAdding} data={data} onSaved={refresh} />
      <CommitmentDialog jobId={jobId} open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} data={data} editing={editing} onSaved={refresh} />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this commitment?"
        description={removing ? `${commitmentCode(removing.number)} — ${removing.vendor.name}, ${usd(removing.amount)}. It has no expenses against it, so nothing else changes.` : undefined}
        tone="danger"
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </div>
  );
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("tabular-nums", strong ? "text-lg font-semibold" : "text-base font-medium")}>{value}</div>
    </div>
  );
}

function CommitmentDialog({
  jobId,
  open,
  onOpenChange,
  data,
  editing,
  onSaved,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: JobCommitments;
  editing?: CommitmentRow | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <CommitmentForm jobId={jobId} data={data} editing={editing ?? null} onSaved={onSaved} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CommitmentForm({ jobId, data, editing, onSaved, onClose }: { jobId: string; data: JobCommitments; editing: CommitmentRow | null; onSaved: () => void; onClose: () => void }) {
  const [vendorId, setVendorId] = useState(editing?.vendor.id ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [budgetLineId, setBudgetLineId] = useState(editing?.budgetLine?.id ?? "");
  const [committedDate, setCommittedDate] = useState(editing ? editing.committedDate.slice(0, 10) : "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const vendorLocked = Boolean(editing && editing.expenseCount > 0);

  // The warning for the vendor being picked. It never blocks the save.
  const { data: vendor } = useQuery<{ vendor: { name: string }; compliance: ComplianceSummary }>({
    queryKey: ["vendors", "detail", vendorId],
    queryFn: () => fetchJson(`/api/vendors/${vendorId}`),
    retry: retryServerErrors,
    enabled: Boolean(vendorId),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...(vendorLocked ? {} : { vendorId }),
        description,
        amount: Number(amount),
        budgetLineId: budgetLineId || null,
        committedDate: committedDate || null,
        notes: notes || null,
      };
      return fetchJson(editing ? `/api/commitments/${editing.id}` : `/api/jobs/${jobId}/commitments`, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      onSaved();
      toast.success(editing ? "Commitment saved" : "Commitment added — it now counts as committed cost");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = vendorId && description.trim() && Number(amount) > 0;
  const lineName = (v: string) => (v === NO_LINE ? "No budget line" : data.budgetLines.find((l) => l.id === v)?.name ?? "No budget line");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${commitmentCode(editing.number)}` : "Add commitment"}</DialogTitle>
        <DialogDescription>What has been ordered or agreed with a vendor and not paid yet. It is not a bill and records no payment.</DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label>Vendor</Label>
        {vendorLocked ? (
          <p className="text-sm">{editing?.vendor.name} <span className="text-xs text-muted-foreground">— fixed, because expenses are linked to it</span></p>
        ) : (
          <VendorSelect value={vendorId} onChange={setVendorId} noneLabel="Choose a vendor" />
        )}
        {vendor && vendorId && <ComplianceCallout compliance={vendor.compliance} vendorName={vendor.vendor.name} />}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="commitment-description">What was ordered or agreed</Label>
        <Textarea id="commitment-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} placeholder="Impact windows, 14 openings — quote #4471" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="commitment-amount">Amount ($)</Label>
          <Input id="commitment-amount" type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {editing && editing.received > 0 && <p className="text-xs text-muted-foreground">{usd(editing.received)} already received against it.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commitment-date">Date</Label>
          <Input id="commitment-date" type="date" value={committedDate} onChange={(e) => setCommittedDate(e.target.value)} />
        </div>
      </div>

      {data.budgetLines.length > 0 && (
        <div className="space-y-1.5">
          <Label>Budget line (optional)</Label>
          <Select value={budgetLineId || NO_LINE} onValueChange={(v: string | null) => setBudgetLineId(!v || v === NO_LINE ? "" : v)}>
            <SelectTrigger className="w-full" aria-label="Budget line">
              <SelectValue>{lineName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_LINE}>No budget line</SelectItem>
              {data.budgetLines.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                  {l.category ? <span className="text-xs text-muted-foreground"> · {l.category}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="commitment-notes">Notes</Label>
        <Textarea id="commitment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={4000} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? "Saving…" : editing ? "Save" : "Add commitment"}</Button>
      </DialogFooter>
    </form>
  );
}
