"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { DollarSign, Landmark, Plus, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { FineSummary } from "@/lib/violations/fines";
import { FINE_ENTRY_LABEL } from "./status";
import { money, useCaseAction, violationKeys, type CaseData } from "./use-violations";

type Entry = { id: string; type: string; amount: string | null; effectiveAt: string; reference: string | null; notes: string | null; fileId: string | null; createdAt: string };
type FinesResponse = { summary: FineSummary & { officialBalance: { amount: string; asOf: string; label: string } | null; accrual: { stoppedAt: string | null; status: string; days: number; dailyFine: string; initial: string; accrued: string } }; entries: Entry[]; terms: Record<string, string | null> };

const ENTRY_TYPES = ["OFFICIAL_BALANCE", "PAYMENT", "ADMIN_COST", "FINE_IMPOSED", "ACCRUAL_STARTED", "ACCRUAL_STOPPED", "MITIGATION_REQUESTED", "MITIGATION_DECIDED", "ADJUSTMENT", "NOTE"] as const;

/**
 * Two figures, always apart: the SYSTEM ESTIMATE (computed from the fine
 * terms on the notice) and the OFFICIAL balance the agency stated, with its
 * date. Then the ledger every official figure came from.
 */
export function FinesPanel({ data }: { data: CaseData }) {
  const { data: fines, isLoading } = useQuery<FinesResponse>({ queryKey: violationKeys.fines(data.id), queryFn: () => fetchJson(`/api/violations/${data.id}/fines`), retry: retryServerErrors });
  const [adding, setAdding] = useState(false);
  const [terms, setTerms] = useState(false);
  const [override, setOverride] = useState(false);
  const [lien, setLien] = useState<"record" | "release" | null>(null);
  const can = data.permissions.canManageFines;
  if (isLoading || !fines) return <Skeleton className="h-48" />;
  const s = fines.summary;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-muted-foreground">System estimate</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{money(s.effectiveEstimate)}</p>
          <p className="text-xs text-muted-foreground">
            {s.accrual.status === "ACCRUING" ? `Accruing ${money(s.accrual.dailyFine)}/day · ${s.accrual.days} day${s.accrual.days === 1 ? "" : "s"} so far` : s.accrual.status === "STOPPED" ? `Accrual stopped ${s.accrual.stoppedAt ? format(new Date(s.accrual.stoppedAt), "MMM d, yyyy") : ""}` : s.accrual.status === "NOT_STARTED" ? "Accrual not started" : "No daily fine set"}
          </p>
          {s.overrideApplied && (
            <p className="mt-1 text-[11px] text-tone-warning-fg">
              Overridden — system figure {money(s.systemEstimate)}
              {s.overrideStale ? " · fine terms changed since" : ""}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">Exposure after payments, admin costs and mitigation: {money(s.exposure)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-muted-foreground">{s.officialBalance ? s.officialBalance.label : "Official (agency) balance"}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{s.officialBalance ? money(s.officialBalance.amount) : "—"}</p>
          <p className="text-xs text-muted-foreground">{s.officialBalance ? (s.officialVsEstimateDelta && Number(s.officialVsEstimateDelta) !== 0 ? `${Number(s.officialVsEstimateDelta) > 0 ? "+" : ""}${money(s.officialVsEstimateDelta)} vs the estimate` : "Matches the estimate") : "Enter the agency's statement below. Never merged with the estimate."}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-muted-foreground">Lien</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{data.lienStatus === "NONE" ? "None" : data.lienStatus === "RECORDED" ? money(data.lienAmount) : "Released"}</p>
          <p className="text-xs text-muted-foreground">
            {data.lienStatus === "RECORDED" ? `Recorded ${data.lienRecordedAt ? format(new Date(data.lienRecordedAt), "MMM d, yyyy") : ""}${data.lienInstrumentNumber ? ` · ${data.lienInstrumentNumber}` : ""}` : data.lienStatus === "RELEASED" ? `Released ${data.lienReleasedAt ? format(new Date(data.lienReleasedAt), "MMM d, yyyy") : ""}` : "No lien recorded"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {can && (
          <Button size="sm" variant="brand" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add ledger entry
          </Button>
        )}
        {can && (
          <Button size="sm" variant="outline" onClick={() => setTerms(true)}>
            <DollarSign className="size-3.5" /> Fine terms
          </Button>
        )}
        {data.permissions.canOverrideFines && (
          <Button size="sm" variant="outline" onClick={() => setOverride(true)}>
            <Scale className="size-3.5" /> {s.overrideApplied ? "Change override" : "Override estimate"}
          </Button>
        )}
        {can && data.lienStatus !== "RECORDED" && (
          <Button size="sm" variant="outline" onClick={() => setLien("record")}>
            <Landmark className="size-3.5" /> Record lien
          </Button>
        )}
        {can && data.lienStatus === "RECORDED" && (
          <Button size="sm" variant="outline" onClick={() => setLien("release")}>
            <Landmark className="size-3.5" /> Record lien release
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          Paid {money(data.amountPaid)} · admin {money(data.adminCosts)}
          {data.mitigationStatus !== "NONE" ? ` · mitigation ${data.mitigationStatus.toLowerCase().replace("_", " ")}${data.mitigationGrantedAmount ? ` ${money(data.mitigationGrantedAmount)}` : ""}` : ""}
          {data.fineResolvedAt ? ` · resolved ${format(new Date(data.fineResolvedAt), "MMM d, yyyy")}` : ""}
        </span>
      </div>

      {fines.entries.length === 0 ? (
        <Callout tone="neutral">No ledger entries yet. Official balances, payments, mitigation decisions and the lien all go here.</Callout>
      ) : (
        <div className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fines.entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs tabular-nums">{format(new Date(e.effectiveAt), "MMM d, yyyy")}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {FINE_ENTRY_LABEL[e.type] ?? e.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{money(e.amount)}</TableCell>
                  <TableCell className="text-xs">{e.reference ?? "—"}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                    {e.notes ?? ""}
                    {e.fileId && (
                      <a href={`/api/files/${e.fileId}`} target="_blank" rel="noreferrer" className="ml-1 underline">
                        file
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <EntryDialog open={adding} onOpenChange={setAdding} caseId={data.id} />
      <TermsDialog open={terms} onOpenChange={setTerms} data={data} />
      <ConfirmDialog
        open={override}
        onOpenChange={setOverride}
        title={s.overrideApplied ? "Change the estimate override" : "Override the system estimate"}
        description="The system figure stays visible; the override replaces it in the exposure. Admin/manager only, audited."
        confirmLabel="Save override"
        requireReason
        reasonLabel="Why"
        pending={false}
        onConfirm={() => undefined}
      >
        <OverrideForm caseId={data.id} current={data.fineEstimateOverride} onDone={() => setOverride(false)} />
      </ConfirmDialog>
      <LienDialog mode={lien} onClose={() => setLien(null)} caseId={data.id} />
    </div>
  );
}

function EntryDialog({ open, onOpenChange, caseId }: { open: boolean; onOpenChange: (o: boolean) => void; caseId: string }) {
  const [type, setType] = useState<(typeof ENTRY_TYPES)[number]>("OFFICIAL_BALANCE");
  const [amount, setAmount] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const add = useCaseAction<Record<string, unknown>>(caseId, "/fines/entries", { success: "Ledger entry recorded" });
  const needsAmount = ["OFFICIAL_BALANCE", "FINE_IMPOSED", "ADMIN_COST", "PAYMENT", "ACCRUAL_STARTED"].includes(type);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a ledger entry</DialogTitle>
          <DialogDescription>Official figures only. The case&apos;s balance, payments and accrual dates are mirrored from these rows.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Entry</Label>
            <Select value={type} onValueChange={(v: string | null) => v && setType(v as typeof type)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => FINE_ENTRY_LABEL[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ENTRY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {FINE_ENTRY_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{type === "ACCRUAL_STARTED" ? "Daily rate" : "Amount"}{needsAmount ? "" : " (optional)"}</Label>
            <Input className="mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <Label className="text-xs">{type === "OFFICIAL_BALANCE" ? "As of" : type === "PAYMENT" ? "Paid on" : "Effective"}</Label>
            <Input type="date" className="mt-1" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Reference</Label>
            <Input className="mt-1" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Statement id, receipt #…" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={add.isPending || (needsAmount && !amount.trim())} onClick={() => add.mutate({ type, amount: amount.trim() || null, effectiveAt, reference: reference.trim() || null, notes: notes.trim() || null }, { onSuccess: () => onOpenChange(false) })}>
            {add.isPending ? "Saving…" : "Record"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TermsDialog({ open, onOpenChange, data }: { open: boolean; onOpenChange: (o: boolean) => void; data: CaseData }) {
  const [f, setF] = useState({ initialFine: data.initialFine ?? "", dailyFine: data.dailyFine ?? "", accrualStartDate: data.fineAccrualStartDate?.slice(0, 10) ?? "", accrualStoppedAt: data.fineAccrualStoppedAt?.slice(0, 10) ?? "", adminCosts: data.adminCosts ?? "", fineResolvedAt: data.fineResolvedAt?.slice(0, 10) ?? "" });
  const save = useCaseAction<Record<string, unknown>>(data.id, "/fines/terms", { success: "Fine terms saved" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fine terms</DialogTitle>
          <DialogDescription>From the notice or order. The estimate is computed from these; only the official stop date stops it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Initial fine</Label>
            <Input className="mt-1" inputMode="decimal" value={f.initialFine} onChange={(e) => set("initialFine", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Daily fine</Label>
            <Input className="mt-1" inputMode="decimal" value={f.dailyFine} onChange={(e) => set("dailyFine", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Accrual start</Label>
            <Input type="date" className="mt-1" value={f.accrualStartDate} onChange={(e) => set("accrualStartDate", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Official stop date</Label>
            <Input type="date" className="mt-1" value={f.accrualStoppedAt} onChange={(e) => set("accrualStoppedAt", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Administrative costs (total)</Label>
            <Input className="mt-1" inputMode="decimal" value={f.adminCosts} onChange={(e) => set("adminCosts", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Fines resolved on</Label>
            <Input type="date" className="mt-1" value={f.fineResolvedAt} onChange={(e) => set("fineResolvedAt", e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={save.isPending} onClick={() => save.mutate({ initialFine: f.initialFine.trim() || null, dailyFine: f.dailyFine.trim() || null, accrualStartDate: f.accrualStartDate || null, accrualStoppedAt: f.accrualStoppedAt || null, adminCosts: f.adminCosts.trim() || "0", fineResolvedAt: f.fineResolvedAt || null }, { onSuccess: () => onOpenChange(false) })}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OverrideForm({ caseId, current, onDone }: { caseId: string; current: string | null; onDone: () => void }) {
  const [amount, setAmount] = useState(current ?? "");
  const [reason, setReason] = useState("");
  const save = useCaseAction<Record<string, unknown>>(caseId, "/fines/override", { success: "Estimate override saved" });
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Override amount (blank clears the override)</Label>
        <Input className="mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </div>
      <div>
        <Label className="text-xs">Reason</Label>
        <Textarea className="mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Agency waived weekend days per the officer" />
      </div>
      <div className="flex justify-end">
        <Button variant="brand" disabled={save.isPending || !reason.trim()} onClick={() => save.mutate({ amount: amount.trim() || null, reason: reason.trim() }, { onSuccess: onDone })}>
          {save.isPending ? "Saving…" : "Save override"}
        </Button>
      </div>
    </div>
  );
}

function LienDialog({ mode, onClose, caseId }: { mode: "record" | "release" | null; onClose: () => void; caseId: string }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [instrument, setInstrument] = useState("");
  const [bookPage, setBookPage] = useState("");
  const [notes, setNotes] = useState("");
  const record = useCaseAction<Record<string, unknown>>(caseId, "/lien", { success: "Lien recorded" });
  const release = useCaseAction<Record<string, unknown>>(caseId, "/lien", { method: "DELETE", success: "Lien release recorded" });
  const pending = record.isPending || release.isPending;
  return (
    <Dialog open={Boolean(mode)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "record" ? "Record a lien" : "Record the lien release"}</DialogTitle>
          <DialogDescription>From the recorded instrument. Goes to the ledger and the case.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {mode === "record" && (
            <div>
              <Label className="text-xs">Lien amount</Label>
              <Input className="mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          <div>
            <Label className="text-xs">{mode === "record" ? "Recorded on" : "Released on"}</Label>
            <Input type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Instrument number</Label>
            <Input className="mt-1" value={instrument} onChange={(e) => setInstrument(e.target.value)} />
          </div>
          {mode === "record" && (
            <div>
              <Label className="text-xs">Book / page</Label>
              <Input className="mt-1" value={bookPage} onChange={(e) => setBookPage(e.target.value)} />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={pending}
            onClick={() =>
              mode === "record"
                ? record.mutate({ amount: amount.trim() || null, recordedAt: date, instrumentNumber: instrument.trim() || null, bookPage: bookPage.trim() || null, notes: notes.trim() || null }, { onSuccess: onClose })
                : release.mutate({ releasedAt: date, releaseInstrumentNumber: instrument.trim() || null, notes: notes.trim() || null }, { onSuccess: onClose })
            }
          >
            {pending ? "Saving…" : mode === "record" ? "Record lien" : "Record release"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
