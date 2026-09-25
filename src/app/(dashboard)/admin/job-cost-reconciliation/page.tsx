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
import { NEVER_POSTED_LABEL, type NeverPostedReason } from "@/lib/expenses/reconcile-allocator";

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
type AllocatorRow = {
  source: "card" | "bank";
  id: string;
  externalId: string;
  status: string;
  amount: number;
  date: string;
  payee: string | null;
  crmJobId: string | null;
  crmJobName: string | null;
  jobNumber: string | null;
  lastCrmError: string | null;
  reason?: NeverPostedReason;
  crmExpenseIdHere?: string;
};
type Allocator =
  | { configured: false }
  | { configured: true; ok: false; error: string }
  | {
      configured: true;
      ok: true;
      generatedAt: string;
      counts: { card: number; bank: number; withExpenseId: number };
      missingInCrm: AllocatorRow[];
      neverPosted: AllocatorRow[];
      heldPending: AllocatorRow[];
      totals: {
        missing: { count: number; amount: number };
        neverPosted: { count: number; amount: number; credits: { count: number; amount: number } };
        held: { count: number; amount: number };
      };
    };
type Payload = { allocator: Allocator; pairs: Pair[]; summary: { pairs: number; exact: number; amount: number }; decisions: Decision[] };

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

          <AllocatorSection a={data.allocator} />

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

/** What only cc-allocator's side can show. */
function AllocatorSection({ a }: { a: Allocator }) {
  if (!a.configured) {
    return (
      <Callout tone="info" title="cc-allocator's side is not connected">
        Set <span className="font-mono text-xs">CC_ALLOCATOR_BASE_URL</span> and <span className="font-mono text-xs">CC_ALLOCATOR_RECON_KEY</span> on the CRM (and <span className="font-mono text-xs">CRM_RECON_API_KEY</span> on cc-allocator) to also see postings it recorded that the CRM no longer holds, and rows linked to a job that never posted.
      </Callout>
    );
  }
  if (!a.ok) {
    return <Callout tone="warning" title="Couldn't read cc-allocator's postings">{a.error}</Callout>;
  }
  const empty = a.missingInCrm.length === 0 && a.neverPosted.length === 0 && a.heldPending.length === 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">From cc-allocator&apos;s side</CardTitle>
        <p className="text-xs text-muted-foreground">
          {a.counts.card} card and {a.counts.bank} bank rows linked to a CRM job, {a.counts.withExpenseId} with a CRM expense id · read {format(new Date(a.generatedAt), "MMM d, HH:mm")}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {empty && <p className="py-2 text-sm text-muted-foreground">Everything cc-allocator has sent is here, and nothing linked to a job is waiting.</p>}

        {a.missingInCrm.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              Posted by cc-allocator, missing here
              <Badge variant="destructive" className="text-[10px]">{a.totals.missing.count} · {money(a.totals.missing.amount)}</Badge>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">cc-allocator holds a CRM expense id for these, so it will never retry. They were deleted in the CRM after posting; re-enter by hand if that was a mistake.</p>
            <AllocatorTable rows={a.missingInCrm} />
          </div>
        )}

        {a.neverPosted.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              Linked to a job, never posted
              <Badge variant="outline" className="text-[10px]">
                {a.totals.neverPosted.count} · {money(a.totals.neverPosted.amount)}
                {a.totals.neverPosted.credits.count > 0 ? ` (incl. ${a.totals.neverPosted.credits.count} credits, ${money(a.totals.neverPosted.credits.amount)})` : ""}
              </Badge>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">Fix these in cc-allocator: approve, turn the CRM leg on, or read the error.</p>
            <AllocatorTable rows={a.neverPosted} showReason />
          </div>
        )}

        {a.heldPending.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              Held for review here
              <Badge variant="outline" className="text-[10px]">{a.totals.held.count} · {money(a.totals.held.amount)}</Badge>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">Arrived as Pending because a typed-in charge matched. Approve or remove the twin from the job&apos;s Expenses tab.</p>
            <AllocatorTable rows={a.heldPending} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AllocatorTable({ rows, showReason = false }: { rows: AllocatorRow[]; showReason?: boolean }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Job</TableHead>
            <TableHead>Payee</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>{showReason ? "Why" : "cc-allocator status"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.externalId}>
              <TableCell>
                {r.crmJobId ? (
                  <Link href={`/jobs/${r.crmJobId}?tab=money&sub=expenses`} className="font-mono text-xs hover:underline">
                    {r.jobNumber ?? r.crmJobName ?? r.crmJobId}
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="max-w-[220px] truncate text-sm" title={r.payee ?? ""}>{r.payee ?? "—"}</TableCell>
              <TableCell className="text-xs">{day(r.date)}</TableCell>
              <TableCell className={`text-right tabular-nums ${r.amount < 0 ? "text-green-700" : ""}`}>{money(r.amount)}</TableCell>
              <TableCell className="text-xs">{r.source === "bank" ? "bank feed" : "card feed"}</TableCell>
              <TableCell className="text-xs">
                {showReason && r.reason ? NEVER_POSTED_LABEL[r.reason] : r.status.toLowerCase().replace(/_/g, " ")}
                {r.lastCrmError && <div className="max-w-[260px] truncate text-muted-foreground" title={r.lastCrmError}>{r.lastCrmError}</div>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
