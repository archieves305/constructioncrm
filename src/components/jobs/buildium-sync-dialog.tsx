"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudUpload, Loader2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BankAccount = {
  id: string;
  name: string;
  last4: string | null;
  type: string | null;
};

type Vendor = {
  id: string;
  name: string;
};

type DuplicateMatch = {
  id: string;
  date: string;
  amount: number;
  payeeId: number | null;
  memo: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: {
    id: string;
    jobId: string;
    vendor: string | null;
    amount: string;
  };
};

export function BuildiumSyncDialog({ open, onOpenChange, expense }: Props) {
  const qc = useQueryClient();
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [vendorQuery, setVendorQuery] = useState<string>(expense.vendor ?? "");
  const [vendorId, setVendorId] = useState<string>("");
  const [vendorName, setVendorName] = useState<string>("");

  useEffect(() => {
    if (open) {
      setVendorQuery(expense.vendor ?? "");
      setVendorId("");
      setVendorName("");
    }
  }, [open, expense.id, expense.vendor]);

  const banks = useQuery<{ accounts: BankAccount[]; defaultId: string | null }>({
    queryKey: ["buildium-bank-accounts"],
    queryFn: () =>
      fetch("/api/buildium/bank-accounts").then((r) => r.json()),
    enabled: open,
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    if (!bankAccountId && banks.data?.defaultId) {
      setBankAccountId(banks.data.defaultId);
    }
  }, [banks.data, bankAccountId]);

  const debouncedQ = useDebounce(vendorQuery, 250);

  const vendors = useQuery<{ vendors: Vendor[]; total: number }>({
    queryKey: ["buildium-vendors", debouncedQ],
    queryFn: () =>
      fetch(
        `/api/buildium/vendors?q=${encodeURIComponent(debouncedQ)}&limit=15`,
      ).then((r) => r.json()),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const bestMatch = useMemo(() => {
    if (!vendors.data?.vendors?.length) return null;
    return vendors.data.vendors[0];
  }, [vendors.data]);

  useEffect(() => {
    if (!vendorId && bestMatch && vendorQuery) {
      setVendorId(bestMatch.id);
      setVendorName(bestMatch.name);
    }
  }, [bestMatch, vendorId, vendorQuery]);

  const duplicates = useQuery<{ matches: DuplicateMatch[]; error?: string }>({
    queryKey: ["buildium-duplicate-check", expense.id, bankAccountId, vendorId],
    queryFn: () => {
      const params = new URLSearchParams({ bankAccountId });
      if (vendorId) params.set("vendorId", vendorId);
      return fetch(
        `/api/expenses/${expense.id}/buildium-duplicate-check?${params.toString()}`,
      ).then((r) => r.json());
    },
    enabled: open && Boolean(bankAccountId),
    staleTime: 30_000,
  });

  const [override, setOverride] = useState(false);
  useEffect(() => {
    if (open) setOverride(false);
  }, [open, expense.id]);

  const matches = duplicates.data?.matches ?? [];
  const hasDuplicates = matches.length > 0;

  const sync = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/expenses/${expense.id}/buildium-sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bankAccountId: Number(bankAccountId),
            vendorId: Number(vendorId),
          }),
        },
      );
      const body = await res.json().catch(() => ({ error: "Sync failed" }));
      if (!res.ok) throw new Error(body.error || "Sync failed");
      return body as { ok: true; billId?: string; skipped?: boolean; reason?: string };
    },
    onSuccess: (body) => {
      qc.invalidateQueries({ queryKey: ["expenses", expense.jobId] });
      if ("skipped" in body && body.skipped) {
        toast.info(body.reason || "Already posted");
      } else {
        toast.success(`Posted to Buildium (ID ${body.billId})`);
      }
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = Boolean(
    bankAccountId &&
      vendorId &&
      !sync.isPending &&
      (!hasDuplicates || override),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Post to Buildium</DialogTitle>
          <DialogDescription>
            Record ${Number(expense.amount).toLocaleString()} as a bank-account
            transaction against the linked rental property.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Bank account</Label>
            {banks.isLoading ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : banks.data?.accounts?.length ? (
              <select
                className="w-full rounded border p-2"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                {banks.data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.last4 ? ` (…${a.last4})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-red-700">
                Could not load bank accounts.
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Vendor (payee)</Label>
            <Input
              value={vendorQuery}
              placeholder="Type to search Buildium vendors…"
              onChange={(e) => {
                setVendorQuery(e.target.value);
                setVendorId("");
                setVendorName("");
              }}
            />
            {vendors.isLoading && (
              <div className="mt-1 text-xs text-muted-foreground">Searching…</div>
            )}
            {!vendors.isLoading && vendors.data?.vendors && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded border bg-white">
                {vendors.data.vendors.length === 0 && (
                  <div className="p-2 text-xs text-muted-foreground">
                    No vendors match. Add this vendor in Buildium first.
                  </div>
                )}
                {vendors.data.vendors.map((v) => (
                  <button
                    type="button"
                    key={v.id}
                    className={`block w-full px-2 py-1 text-left text-xs hover:bg-blue-50 ${
                      vendorId === v.id ? "bg-blue-100" : ""
                    }`}
                    onClick={() => {
                      setVendorId(v.id);
                      setVendorName(v.name);
                      setVendorQuery(v.name);
                    }}
                  >
                    {v.name}{" "}
                    <span className="text-muted-foreground">#{v.id}</span>
                  </button>
                ))}
              </div>
            )}
            {vendorId && vendorName && (
              <div className="mt-1 text-xs text-emerald-700">
                Selected: {vendorName} (#{vendorId})
              </div>
            )}
          </div>

          {hasDuplicates && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div className="min-w-0">
                  <div className="font-medium text-amber-900">
                    {matches.length} possible duplicate{matches.length === 1 ? "" : "s"} already in Buildium for this property, date, and amount
                  </div>
                  <ul className="mt-1 space-y-0.5 text-amber-900">
                    {matches.map((m) => (
                      <li key={m.id} className="truncate">
                        · {m.date} · ${m.amount.toLocaleString()} · Check #{m.id}
                        {m.payeeId ? ` · payee ${m.payeeId}` : ""}
                        {m.memo ? ` · ${m.memo}` : ""}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={override}
                      onChange={(e) => setOverride(e.target.checked)}
                    />
                    <span className="text-amber-900">
                      Post anyway — I've confirmed this isn't a duplicate
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {duplicates.isLoading && bankAccountId && (
            <p className="text-[11px] text-muted-foreground">
              Checking Buildium for possible duplicates…
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Attachment upload — coming next.
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sync.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            variant={hasDuplicates ? "destructive" : "default"}
            onClick={() => sync.mutate()}
          >
            {sync.isPending ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Posting…
              </>
            ) : hasDuplicates ? (
              <>
                <CloudUpload className="mr-1 h-4 w-4" /> Post anyway
              </>
            ) : (
              <>
                <CloudUpload className="mr-1 h-4 w-4" /> Post to Buildium
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
