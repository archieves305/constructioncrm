"use client";

import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";

export type PossibleDuplicate = {
  id: string;
  amount: number;
  incurredDate: string;
  vendor: string | null;
  status: "PENDING" | "APPROVED";
  fromBank: boolean;
  difference: number;
};

export type TwinCheck = { paymentId: string; crew: string; amount: number; rows: PossibleDuplicate[] };

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => format(new Date(`${iso}T12:00:00`), "MMM d, yyyy");

/**
 * Shown right after a crew payment is recorded when the same money already
 * sits on the job as an expense (usually the bank feed's posting). A labor
 * contract counts in full, so leaving both would count the payment twice.
 */
export function CrewPaymentTwinDialog({ check, jobId, onClose }: { check: TwinCheck | null; jobId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const rows = (check?.rows ?? []).filter((r) => !done.has(r.id));

  const decide = async (row: PossibleDuplicate, body: Record<string, string>) => {
    setBusy(row.id);
    try {
      await fetchJson(`/api/expenses/${row.id}/labor-payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      toast.success(body.action === "same_money" ? "Counted once, through the crew payment" : "Kept as a cost of its own");
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      qc.invalidateQueries({ queryKey: ["expenses", jobId] });
      const next = new Set(done).add(row.id);
      setDone(next);
      if (check && check.rows.every((r) => next.has(r.id))) onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={Boolean(check) && rows.length > 0} onOpenChange={(v) => { if (!v) { setDone(new Set()); onClose(); } }}>
      <DialogContent className="sm:max-w-lg" data-testid="crew-twin-dialog">
        <DialogHeader>
          <DialogTitle>Is this payment already on the job?</DialogTitle>
          <DialogDescription>
            {check ? `The ${money(check.amount)} payment to ${check.crew} looks like a charge already in this job's expenses. The labor contract already counts this money, so keeping both counts it twice.` : null}
          </DialogDescription>
        </DialogHeader>
        <ul className="min-w-0 divide-y rounded-md border text-sm">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium tabular-nums">{money(r.amount)} · {day(r.incurredDate)}</span>
                <span className="text-xs text-muted-foreground">{r.fromBank ? "bank / card feed" : "typed in"}{r.status === "PENDING" ? " · waiting for approval" : ""}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground" title={r.vendor ?? ""}>{r.vendor ?? "no payee"}</div>
              {Math.abs(r.difference) >= 0.01 && (
                <div className="text-xs text-tone-warning-fg">
                  {r.difference > 0 ? `${money(r.difference)} more than this payment — if part of it paid for something else, file that part where it belongs.` : `${money(-r.difference)} less than this payment.`}
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => decide(r, { action: "separate" })}>Both are real</Button>
                <Button size="sm" disabled={busy === r.id || !check} onClick={() => check && decide(r, { action: "same_money", laborPaymentId: check.paymentId })}>
                  {busy === r.id ? "Working…" : "Same money — count once"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Undecided rows wait under Admin → Cost Reconciliation → Crew payments.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setDone(new Set()); onClose(); }}>Decide later</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
