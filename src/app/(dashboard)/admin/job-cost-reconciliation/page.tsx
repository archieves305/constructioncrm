"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import { Check, CopyX, HardHat, Scale } from "lucide-react";
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
  jobAddress?: string | null;
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
  ack?: { note: string | null; decidedAt: string; decidedBy: string | null } | null;
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
      acknowledged: AllocatorRow[];
      neverPosted: AllocatorRow[];
      heldPending: AllocatorRow[];
      totals: {
        missing: { count: number; amount: number };
        neverPosted: { count: number; amount: number; credits: { count: number; amount: number } };
        held: { count: number; amount: number };
        acknowledged: { count: number; amount: number };
      };
    };
type CrewExpense = { id: string; jobId: string; jobNumber: string | null; jobAddress: string | null; amount: number; incurredDate: string; vendor: string | null; status: "PENDING" | "APPROVED"; fromBank: boolean };
type Crew = {
  twins: { expense: CrewExpense; payment: { id: string; amount: number; paidDate: string; crew: string }; difference: number; gapDays: number; reason: "amount" | "payee" }[];
  crewPaidAsExpense: { expense: CrewExpense; contract: { id: string; crew: string } }[];
};
type Payload = { allocator: Allocator; crew: Crew; pairs: Pair[]; summary: { pairs: number; exact: number; amount: number }; decisions: Decision[] };

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
                            <Link href={`/jobs/${p.jobId}?tab=money&sub=expenses`} className="text-xs font-medium hover:underline">
                              {p.jobAddress ?? p.jobNumber}
                            </Link>
                            {p.jobAddress && <span className="ml-1 font-mono text-[10px] text-muted-foreground">{p.jobNumber}</span>}
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
                                      `Remove the typed-in ${money(p.amount)} charge (${p.manual.vendor ?? "no vendor"}, ${day(p.manual.incurredDate)}) on ${p.jobAddress ?? p.jobNumber}? The cc-allocator posting stays. This cannot be undone.`,
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

          <CrewPaymentsSection crew={data.crew} />

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
  const qc = useQueryClient();
  const [showAcked, setShowAcked] = useState(false);
  const ack = useMutation({
    mutationFn: ({ externalId, undo }: { externalId: string; undo?: boolean }) =>
      fetchJson("/api/admin/job-cost-reconciliation/acknowledge", {
        method: undo ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalId }),
      }),
    onSuccess: (_r, v) => {
      toast.success(v.undo ? "Back on the missing list" : "Acknowledged — it will stay out of the missing list");
      qc.invalidateQueries({ queryKey: ["job-cost-reconciliation"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
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
  const acknowledge = (externalId: string) => (
    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ack.isPending} onClick={() => ack.mutate({ externalId })}>
      Acknowledge
    </Button>
  );
  const unacknowledge = (externalId: string) => (
    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={ack.isPending} onClick={() => ack.mutate({ externalId, undo: true })}>
      Undo
    </Button>
  );
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
            <p className="mb-2 text-xs text-muted-foreground">cc-allocator holds a CRM expense id for these, so it will never retry. They were deleted in the CRM after posting: re-enter by hand if that was a mistake, or acknowledge it if the deletion was deliberate.</p>
            <AllocatorTable rows={a.missingInCrm} action={(r) => acknowledge(r.externalId)} />
          </div>
        )}

        {a.acknowledged.length > 0 && (
          <div>
            <button type="button" className="mb-1 flex items-center gap-2 text-sm font-medium hover:underline" onClick={() => setShowAcked((v) => !v)}>
              Acknowledged as deliberately deleted
              <Badge variant="outline" className="text-[10px]">{a.totals.acknowledged.count} · {money(a.totals.acknowledged.amount)}</Badge>
              <span className="text-xs font-normal text-muted-foreground">{showAcked ? "hide" : "show"}</span>
            </button>
            {showAcked && (
              <AllocatorTable
                rows={a.acknowledged}
                statusText={(r) => (r.ack ? `acknowledged ${format(new Date(r.ack.decidedAt), "MMM d, yyyy")}${r.ack.decidedBy ? ` by ${r.ack.decidedBy}` : ""}` : "acknowledged")}
                action={(r) => unacknowledge(r.externalId)}
              />
            )}
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

function AllocatorTable({
  rows,
  showReason = false,
  action,
  statusText,
}: {
  rows: AllocatorRow[];
  showReason?: boolean;
  action?: (r: AllocatorRow) => React.ReactNode;
  statusText?: (r: AllocatorRow) => string;
}) {
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
            {action && <TableHead className="w-[120px] text-right" />}
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
                {statusText ? statusText(r) : showReason && r.reason ? NEVER_POSTED_LABEL[r.reason] : r.status.toLowerCase().replace(/_/g, " ")}
                {r.lastCrmError && <div className="max-w-[260px] truncate text-muted-foreground" title={r.lastCrmError}>{r.lastCrmError}</div>}
              </TableCell>
              {action && <TableCell className="text-right">{action(r)}</TableCell>}
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

/**
 * Crew payments counted twice. A labor contract counts in full from the day
 * it is signed, so a payment to the crew that also arrives from the bank as
 * an expense is cost twice (lib/expenses/labor-twins.ts).
 */
function CrewPaymentsSection({ crew }: { crew: Crew }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: ({ expenseId, body }: { expenseId: string; body: Record<string, string> }) => {
      setBusy(expenseId);
      return fetchJson(`/api/expenses/${expenseId}/labor-payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    },
    onSuccess: (_r, v) => {
      toast.success(v.body.action === "separate" ? "Kept as a cost of its own" : v.body.action === "record" ? "Recorded on the labor contract — counted once" : "Counted once, through the crew payment");
      qc.invalidateQueries({ queryKey: ["job-cost-reconciliation"] });
      qc.invalidateQueries({ queryKey: ["job"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusy(null),
  });
  const total = crew.twins.length + crew.crewPaidAsExpense.length;
  const job = (e: CrewExpense) => (
    <>
      <Link href={`/jobs/${e.jobId}?tab=money&sub=expenses`} className="text-xs font-medium hover:underline">
        {e.jobAddress ?? e.jobNumber}
      </Link>
      {e.jobAddress && e.jobNumber && <span className="ml-1 font-mono text-[10px] text-muted-foreground">{e.jobNumber}</span>}
    </>
  );
  const charge = (e: CrewExpense) => (
    <div className="min-w-0">
      <div className="font-medium tabular-nums">{money(e.amount)} · {day(e.incurredDate)}</div>
      <div className="max-w-[260px] truncate text-xs text-muted-foreground" title={e.vendor ?? ""}>{e.vendor ?? "no payee"}</div>
      <div className="text-[10px] text-muted-foreground">{e.fromBank ? "bank / card feed" : "typed in"}{e.status === "PENDING" ? " · held for review" : ""}</div>
    </div>
  );
  const separate = (e: CrewExpense) => (
    <Button size="sm" variant="outline" disabled={busy === e.id} onClick={() => decide.mutate({ expenseId: e.id, body: { action: "separate" } })}>
      A cost of its own
    </Button>
  );
  return (
    <Card data-testid="crew-payments">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HardHat className="size-4 text-muted-foreground" /> Crew payments
          {total > 0 && <Badge variant="secondary" className="text-[10px]">{total}</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A labor contract counts in full from the day it is signed, so a payment to the crew must be recorded on the contract — not also as an expense.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 p-0 pb-2">
        {total === 0 && (
          <div className="p-6">
            <EmptyState icon={Check} title="No crew payment counted twice" description="Bank postings that match a crew payment, or pay a crew with a labor contract on the job, arrive as Pending and show here." />
          </div>
        )}
        {crew.twins.length > 0 && (
          <div className="overflow-x-auto">
            <p className="px-4 text-xs font-medium">Same money as a recorded crew payment?</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Charge</TableHead>
                  <TableHead>Crew payment</TableHead>
                  <TableHead className="w-[280px] text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crew.twins.map((t) => (
                  <TableRow key={t.expense.id} data-testid="crew-twin">
                    <TableCell>{job(t.expense)}</TableCell>
                    <TableCell>{charge(t.expense)}</TableCell>
                    <TableCell>
                      <div className="font-medium tabular-nums">{money(t.payment.amount)} · {day(t.payment.paidDate)}</div>
                      <div className="text-xs text-muted-foreground">{t.payment.crew}{t.gapDays ? ` · ${t.gapDays}d apart` : " · same day"}</div>
                      {Math.abs(t.difference) >= 0.01 && (
                        <div className="text-[10px] text-tone-warning-fg">
                          {t.difference > 0 ? `Bank sent ${money(t.difference)} more — file that part where it belongs` : `Bank sent ${money(-t.difference)} less`}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {separate(t.expense)}
                        <Button size="sm" disabled={busy === t.expense.id} onClick={() => decide.mutate({ expenseId: t.expense.id, body: { action: "same_money", laborPaymentId: t.payment.id } })}>
                          {busy === t.expense.id ? "Working…" : "Same money — count once"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {crew.crewPaidAsExpense.length > 0 && (
          <div className="overflow-x-auto">
            <p className="px-4 text-xs font-medium">Paid to a crew with a labor contract on the job, but not recorded on the contract</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Charge</TableHead>
                  <TableHead>Labor contract</TableHead>
                  <TableHead className="w-[280px] text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crew.crewPaidAsExpense.map((c) => (
                  <TableRow key={c.expense.id} data-testid="crew-unrecorded">
                    <TableCell>{job(c.expense)}</TableCell>
                    <TableCell>{charge(c.expense)}</TableCell>
                    <TableCell className="text-xs">{c.contract.crew}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {separate(c.expense)}
                        <Button size="sm" disabled={busy === c.expense.id} onClick={() => decide.mutate({ expenseId: c.expense.id, body: { action: "record", laborContractId: c.contract.id } })}>
                          {busy === c.expense.id ? "Working…" : "Record on the contract"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
