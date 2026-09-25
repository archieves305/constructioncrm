"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import { Check, CopyX, Scale } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";

type Side = { id: string; vendor: string | null; description: string | null; type: string; billable: boolean; incurredDate: string; createdAt: string; enteredBy: string };
type Pair = {
  key: string;
  jobId: string;
  jobNumber: string;
  jobTitle: string;
  jobType: string;
  amount: number;
  gapDays: number;
  exact: boolean;
  source: "card" | "bank";
  manual: Side;
  external: Side;
};
type Decision = {
  id: string;
  decision: "DUPLICATE" | "KEEP";
  jobId: string;
  amount: number;
  manualVendor: string | null;
  externalVendor: string | null;
  manualIncurredOn: string;
  externalIncurredOn: string;
  note: string | null;
  decidedAt: string;
  decidedBy: string | null;
};
type Payload = { pairs: Pair[]; summary: { pairs: number; exact: number; amount: number }; decisions: Decision[] };

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => format(new Date(`${iso.slice(0, 10)}T12:00:00`), "MMM d, yyyy");

/**
 * Manual charges that look like a cc-allocator posting already on the job.
 * cc-allocator owns money that moved; the CRM owns job costing. When both
 * describe the same dollars the manual row is the one to remove — the
 * posting is the bank's record and its idempotency key.
 */
export default function JobCostReconciliationPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<Payload>({
    queryKey: ["job-cost-reconciliation"],
    queryFn: () => fetchJson("/api/admin/job-cost-reconciliation"),
    retry: retryServerErrors,
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const resolve = useMutation({
    mutationFn: (input: { key: string; manualExpenseId: string; externalExpenseId: string; decision: "DUPLICATE" | "KEEP" }) => {
      setBusyKey(input.key);
      return fetchJson<{ ok: true; decision: string; reversed: number }>("/api/admin/job-cost-reconciliation/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualExpenseId: input.manualExpenseId, externalExpenseId: input.externalExpenseId, decision: input.decision }),
      });
    },
    onSuccess: (r) => {
      toast.success(r.decision === "DUPLICATE" ? `Manual charge removed${r.reversed ? ` — contract reduced by ${money(r.reversed)}` : ""}` : "Kept both charges");
      qc.invalidateQueries({ queryKey: ["job-cost-reconciliation"] });
      qc.invalidateQueries({ queryKey: ["job"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusyKey(null),
  });

  const pairs = data?.pairs ?? [];

  return (
    <div>
      <PageHeader
        title="Cost Reconciliation"
        description="Charges typed into a job that match a posting cc-allocator made for the same amount within three days. Confirming a duplicate deletes the typed-in row and reverses anything it added to the contract; keeping both records that they are separate charges."
      />

      {error ? (
        <Callout tone="danger" title="Couldn't load the reconciliation">{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3 max-w-xl">
            <Stat label="Pairs to rule on" value={String(data.summary.pairs)} />
            <Stat label="Same-day pairs" value={String(data.summary.exact)} />
            <Stat label="Dollars in question" value={money(data.summary.amount)} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="size-4 text-muted-foreground" /> Undecided pairs
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pairs.length === 0 ? (
                <div className="p-6">
                  <EmptyState icon={Check} title="Nothing to reconcile" description="Every cc-allocator posting is accounted for. New postings that look like a typed-in charge arrive as Pending and show here once approved." />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Typed in</TableHead>
                      <TableHead>From cc-allocator</TableHead>
                      <TableHead>Gap</TableHead>
                      <TableHead className="w-[260px] text-right">Decision</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pairs.map((p) => {
                      const busy = busyKey === p.key;
                      return (
                        <TableRow key={p.key}>
                          <TableCell>
                            <Link href={`/jobs/${p.jobId}?tab=money&sub=expenses`} className="font-mono text-xs hover:underline">
                              {p.jobNumber}
                            </Link>
                            <div className="max-w-[160px] truncate text-xs text-muted-foreground" title={p.jobTitle}>
                              {p.jobTitle}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{money(p.amount)}</TableCell>
                          <TableCell>
                            <SideCell s={p.manual} note={`entered by ${p.manual.enteredBy}`} />
                          </TableCell>
                          <TableCell>
                            <SideCell s={p.external} note={p.source === "bank" ? "bank feed" : "card feed"} />
                          </TableCell>
                          <TableCell>
                            {p.exact ? (
                              <Badge className="text-[10px]">same day</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                {p.gapDays}d apart
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => resolve.mutate({ key: p.key, manualExpenseId: p.manual.id, externalExpenseId: p.external.id, decision: "KEEP" })}
                              >
                                Keep both
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Remove the typed-in ${money(p.amount)} charge (${p.manual.vendor ?? "no vendor"}, ${day(p.manual.incurredDate)}) on ${p.jobNumber}? The cc-allocator posting stays. This cannot be undone.`,
                                    )
                                  )
                                    resolve.mutate({ key: p.key, manualExpenseId: p.manual.id, externalExpenseId: p.external.id, decision: "DUPLICATE" });
                                }}
                              >
                                <CopyX className="mr-1 size-3.5" /> {busy ? "Working…" : "Duplicate — remove typed-in"}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent decisions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.decisions.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">No decisions yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Typed in</TableHead>
                      <TableHead>From cc-allocator</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.decisions.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(d.decidedAt), "MMM d, yyyy HH:mm")}</TableCell>
                        <TableCell>
                          <Badge variant={d.decision === "DUPLICATE" ? "destructive" : "outline"} className="text-[10px]">
                            {d.decision === "DUPLICATE" ? "Duplicate removed" : "Kept both"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(d.amount)}</TableCell>
                        <TableCell className="text-xs">
                          {d.manualVendor ?? "—"} · {day(d.manualIncurredOn)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {d.externalVendor ?? "—"} · {day(d.externalIncurredOn)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {d.decidedBy ?? "—"}
                          {d.note && <div className="text-muted-foreground">{d.note}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function SideCell({ s, note }: { s: Side; note: string }) {
  return (
    <div className="min-w-[180px]">
      <div className="text-sm">{s.vendor ?? <span className="text-muted-foreground">no vendor</span>}</div>
      <div className="text-xs text-muted-foreground">
        {day(s.incurredDate)} · {s.type.toLowerCase().replace("_", " ")}
        {s.billable ? " · billable" : ""}
      </div>
      <div className="text-[11px] text-muted-foreground">{note}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white px-4 py-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
