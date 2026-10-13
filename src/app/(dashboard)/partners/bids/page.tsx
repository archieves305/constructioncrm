"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Download, Gavel, Inbox, LayoutGrid, List, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv, toCsv } from "@/lib/csv";
import { BID_STATUS_LABEL, OPEN_BID_STATUSES } from "@/lib/partners/bid-state";
import { bidKpis } from "@/lib/partners/scorecard";
import { cn } from "@/lib/utils";
import { BidFormDialog } from "@/components/partners/bid-form-dialog";
import { BidStatusBadge } from "@/components/partners/bid-panel";
import { personName, useBids, useIntakes, type Bid } from "@/components/partners/use-partners";

type View = "list" | "board";
type Scope = "all" | "mine";
const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));

export default function BidsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Bids />
    </Suspense>
  );
}

function dueText(b: Bid): { text: string; late: boolean } | null {
  if (!b.bidDueAt) return null;
  const d = new Date(b.bidDueAt);
  const open = b.status !== "CLOSED" && b.status !== "SUBMITTED" && b.status !== "SHORTLISTED";
  const late = open && d < new Date();
  return { text: `${format(d, "MMM d, h:mm a")}${open ? ` · ${late ? `${formatDistanceToNowStrict(d)} late` : `in ${formatDistanceToNowStrict(d)}`}` : ""}`, late };
}

function Bids() {
  const url = useSearchParamState();
  const view: View = url.get("view") === "board" ? "board" : "list";
  const scope: Scope = url.get("scope") === "mine" ? "mine" : "all";
  const closed = url.get("closed") === "1";
  const search = url.get("q") ?? "";
  const [draft, setDraft] = useState(search);
  const [creating, setCreating] = useState(false);
  const params = useMemo(() => {
    const p = new URLSearchParams({ pageSize: "500", scope });
    if (closed || view === "board") p.set("closed", "1");
    if (search) p.set("search", search);
    return p;
  }, [scope, closed, search, view]);
  const list = useBids(params);
  const rows = list.data?.rows ?? [];

  const exportCsv = () =>
    downloadCsv(
      `bids-${format(new Date(), "yyyy-MM-dd")}.csv`,
      toCsv(
        rows.map((b) => ({ number: b.number, account: b.organization.name, project: b.projectName, status: b.status === "CLOSED" ? (b.outcome ?? "CLOSED") : BID_STATUS_LABEL[b.status], due: b.bidDueAt?.slice(0, 16).replace("T", " ") ?? "", trades: b.lead.trades.map((t) => t.name).join("; "), estimated: b.lead.estimatedJobValue ?? "", submitted: b.latestAmount ?? "", score: b.decisionScore ?? "", estimator: personName(b.estimator) ?? "" })),
        [
          { key: "number", header: "Bid" },
          { key: "account", header: "Account" },
          { key: "project", header: "Project" },
          { key: "status", header: "Status" },
          { key: "due", header: "Due" },
          { key: "trades", header: "Trades" },
          { key: "estimated", header: "Estimated value" },
          { key: "submitted", header: "Price sent" },
          { key: "score", header: "Score" },
          { key: "estimator", header: "Estimator" },
        ],
      ),
    );

  return (
    <div>
      <PageHeader
        title="Bids"
        breadcrumb={[{ label: "Business Development" }, { label: "Bids" }]}
        description="Bid packages from the GCs: what is due, what needs a go / no-go, what went out and how it ended."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}><Download className="mr-1.5 size-4" /> CSV</Button>
            {list.data?.canManage && <Button variant="brand" size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 size-4" /> Log a bid</Button>}
          </div>
        }
      />
      <BidKpiStrip scope={scope} />
      <IntakeNotice enabled={Boolean(list.data?.canManage)} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SegmentedControl<View> ariaLabel="View" size="sm" value={view} onValueChange={(v) => url.set("view", v === "list" ? null : v)} options={[{ value: "list", label: "List", icon: List }, { value: "board", label: "Board", icon: LayoutGrid }]} />
        <SegmentedControl<Scope> ariaLabel="Whose" size="sm" value={scope} onValueChange={(v) => url.set("scope", v === "all" ? null : v)} options={[{ value: "all", label: "All" }, { value: "mine", label: "Mine" }]} />
        <form onSubmit={(e) => { e.preventDefault(); url.set("q", draft.trim() || null); }} className="flex-1 sm:max-w-xs">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => url.set("q", draft.trim() || null)} placeholder="Search project, GC, BID number…" aria-label="Search bids" />
        </form>
        {view === "list" && (
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input type="checkbox" checked={closed} onChange={(e) => url.set("closed", e.target.checked ? "1" : null)} /> Show closed
          </label>
        )}
      </div>
      {list.isLoading ? (
        <ListSkeleton rows={6} />
      ) : list.isError ? (
        <EmptyState icon={Gavel} title="The bids could not be loaded" description={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Gavel} title={search ? "No bid matches" : "No open bids"} description={search ? "Try another search." : "Log a bid when a GC invites KNU to price a package, from here or from the account's page."} action={list.data?.canManage && !search ? <Button variant="brand" onClick={() => setCreating(true)}><Plus className="mr-1.5 size-4" />Log a bid</Button> : undefined} />
      ) : view === "board" ? (
        <BidBoard rows={rows} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Value</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Score</TableHead>
                  <TableHead className="hidden lg:table-cell">Estimator</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => {
                  const due = dueText(b);
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <Link href={`/leads/${b.leadId}?tab=bid`} className="font-medium text-gray-900 hover:underline">{b.projectName}</Link>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          <span className="font-mono">{b.number}</span> · {b.organization.name}
                          {b.lead.trades.length > 0 && <> · {b.lead.trades.map((t) => t.name).join(", ")}</>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <BidStatusBadge status={b.status} label={b.statusLabel} outcome={b.outcome} />
                        {b.waitingOn && <div className="mt-0.5 text-xs text-muted-foreground">waiting on {b.waitingOn}</div>}
                      </TableCell>
                      <TableCell className={cn("text-sm", due?.late && "font-medium text-tone-danger-fg")}>{due?.text ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="hidden text-right text-sm tabular-nums md:table-cell">{b.latestAmount != null ? usd(b.latestAmount) : usd(b.lead.estimatedJobValue)}{b.latestAmount != null && <div className="text-xs text-muted-foreground">sent</div>}</TableCell>
                      <TableCell className="hidden text-right text-sm tabular-nums lg:table-cell">{b.decisionScore ?? (b.decision === "UNDECIDED" && b.status !== "CLOSED" ? <span className="text-xs text-tone-warning-fg">to decide</span> : "—")}</TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">{personName(b.estimator) ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <BidFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** Read-only columns by status; the bid's tab moves it. Closed bids from the last 90 days only. */
function BidBoard({ rows }: { rows: Bid[] }) {
  const [recent] = useState(() => Date.now() - 90 * 86_400_000);
  const cols = [...OPEN_BID_STATUSES, "CLOSED" as const];
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {cols.map((s) => {
        const items = rows.filter((b) => b.status === s && (s !== "CLOSED" || new Date(b.outcomeAt ?? b.updatedAt).getTime() >= recent));
        return (
          <div key={s} className="w-64 shrink-0 rounded-lg bg-gray-50 p-2">
            <p className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {BID_STATUS_LABEL[s]}<span>{items.length}</span>
            </p>
            <div className="space-y-2">
              {items.map((b) => {
                const due = dueText(b);
                return (
                  <Link key={b.id} href={`/leads/${b.leadId}?tab=bid`} className="block rounded-md border bg-white p-2.5 text-sm shadow-sm hover:border-gray-300">
                    <p className="font-medium leading-snug">{b.projectName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{b.organization.name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {s === "CLOSED" && <BidStatusBadge status={b.status} outcome={b.outcome} />}
                      {due && <span className={cn(due.late ? "font-medium text-tone-danger-fg" : "text-muted-foreground")}>{due.text}</span>}
                      {(b.latestAmount ?? b.lead.estimatedJobValue) != null && <span className="text-muted-foreground">{usd(b.latestAmount ?? b.lead.estimatedJobValue)}</span>}
                    </div>
                  </Link>
                );
              })}
              {items.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted-foreground">—</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The last twelve months at a glance, from the same rows (lib/partners/scorecard.ts). */
function BidKpiStrip({ scope }: { scope: Scope }) {
  const params = useMemo(() => new URLSearchParams({ pageSize: "500", closed: "1", scope }), [scope]);
  const all = useBids(params);
  const [window] = useState(() => ({ from: new Date(Date.now() - 365 * 86_400_000), to: new Date() }));
  if (!all.data || all.data.rows.length === 0) return null;
  const k = bidKpis(
    all.data.rows.map((b) => ({ status: b.status, decision: b.decision, outcome: b.outcome, invitedAt: b.invitedAt, decidedAt: b.decidedAt, submittedAt: b.submittedAt, outcomeAt: b.outcomeAt, estimatedValue: b.lead.estimatedJobValue, latestAmount: b.latestAmount, awardedAmount: b.awardedAmount, lossReason: b.lossReason, estimatingHours: b.estimatingHours })),
    window,
  );
  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
  const tiles: [string, string, string][] = [
    ["Open bids", String(k.open), `${usd(k.openValue)} in play`],
    ["Bid rate", pct(k.bidRate), `${k.bid} bid · ${k.noBid} passed`],
    ["Win rate", pct(k.winRate), `${k.awarded} won · ${k.lost} lost`],
    ["Awarded", usd(k.awardedValue), k.avgTurnaroundDays == null ? "no turnaround yet" : `${k.avgTurnaroundDays} d invite to submit`],
  ];
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {tiles.map(([label, value, sub]) => (
        <Card key={label}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">{label}{label !== "Open bids" && <span className="text-[10px]"> · 12 mo</span>}</p>
            <p className="text-lg font-semibold tabular-nums">{value}</p>
            <p className="truncate text-xs text-muted-foreground">{sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Emailed invitations nobody has looked at yet. */
function IntakeNotice({ enabled }: { enabled: boolean }) {
  const intake = useIntakes("NEW", enabled);
  const n = intake.data?.counts.NEW ?? 0;
  if (!enabled || n === 0) return null;
  return (
    <Link href="/partners/intake" className="mb-3 flex items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 hover:bg-sky-100">
      <Inbox className="size-4" /> {n} emailed invitation{n === 1 ? "" : "s"} waiting for review — create the bid or file {n === 1 ? "it" : "them"}
    </Link>
  );
}
