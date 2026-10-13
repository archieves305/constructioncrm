"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Building2, CalendarClock, ExternalLink, Gavel, Pencil, RotateCcw, Send, Trophy, XCircle } from "lucide-react";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { BID_TRANSITIONS } from "@/lib/partners/bid-state";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { BidFormDialog } from "./bid-form-dialog";
import { BID_STATUS_TONE, personName, useBid, useBidAction, useBidOptions, type BidDetail, type BidOutcome, type BidStatus, type LossReason, type ScoreResult, type SliderKey, type Sliders, type SubmissionKind, type SubmissionMethod } from "./use-partners";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const when = (iso: string | null) => (iso ? format(new Date(iso), "EEE MMM d, yyyy · h:mm a") : null);
const dayLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

const SLIDERS: { key: SliderKey; label: string; low: string; high: string }[] = [
  { key: "margin", label: "Expected margin", low: "thin", high: "healthy" },
  { key: "capacity", label: "Crew and estimator capacity", low: "stretched", high: "free" },
  { key: "competition", label: "Competition", low: "crowded", high: "few bidders" },
  { key: "complexity", label: "Complexity and risk", low: "risky", high: "routine" },
  { key: "plansAndTerms", label: "Plans quality and contract terms", low: "poor", high: "clean" },
];
const REC_LABEL: Record<ScoreResult["recommendation"], string> = { BID: "Bid", REVIEW: "Review before bidding", NO_BID: "Pass" };
const REC_TONE: Record<ScoreResult["recommendation"], "success" | "warning" | "danger"> = { BID: "success", REVIEW: "warning", NO_BID: "danger" };

export function BidStatusBadge({ status, label, outcome }: { status: BidStatus; label?: string; outcome?: BidOutcome | null }) {
  const tone = status === "CLOSED" ? (outcome === "AWARDED" ? "success" : outcome === "LOST" ? "danger" : "neutral") : BID_STATUS_TONE[status];
  const text = status === "CLOSED" && outcome ? { AWARDED: "Awarded", LOST: "Lost", NO_BID: "Passed", CANCELLED: "Cancelled", NO_DECISION: "No decision", REBID: "Rebid" }[outcome] : (label ?? status.toLowerCase());
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", toneClasses(tone).pill)}>{text}</span>;
}

/** Everything about one bid package, on its lead's Bid tab. */
export function BidPanel({ bidId }: { bidId: string }) {
  const bid = useBid(bidId);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState<BidOutcome | null>(null);
  if (bid.isLoading) return <ListSkeleton rows={5} />;
  if (bid.isError || !bid.data) return <EmptyState icon={Gavel} title="The bid could not be loaded" description={(bid.error as Error | null)?.message ?? ""} action={<Button variant="outline" onClick={() => bid.refetch()}>Try again</Button>} />;
  const b = bid.data;
  const p = b.permissions;
  const open = b.status !== "CLOSED";

  return (
    <div className="space-y-4">
      {b.needsReview && <Callout tone="warning" title="Created automatically">Check the facts below and save once to confirm them.</Callout>}
      <FactsCard bid={b} onEdit={() => setEditing(true)} onSubmit={() => setSubmitting(true)} onClose={(o) => setClosing(o)} />
      <DatesCard bid={b} />
      <DecisionCard bid={b} />
      <SubmissionsCard bid={b} onSubmit={() => setSubmitting(true)} />
      {!open && <OutcomeCard bid={b} />}
      {p.canManage && <BidFormDialog open={editing} onOpenChange={setEditing} editing={b} onSaved={() => undefined} />}
      {p.canManage && <SubmissionDialog open={submitting} onOpenChange={setSubmitting} bid={b} />}
      {p.canManage && <CloseDialog outcome={closing} onOpenChange={(o) => !o && setClosing(null)} bid={b} />}
    </div>
  );
}

function FactsCard({ bid: b, onEdit, onSubmit, onClose }: { bid: BidDetail; onEdit: () => void; onSubmit: () => void; onClose: (o: BidOutcome) => void }) {
  const p = b.permissions;
  const { data: options } = useBidOptions();
  const status = useBidAction(b.id, "/status", "Status updated");
  const reopen = useBidAction(b.id, "/reopen", "Bid reopened");
  const [waitingOn, setWaitingOn] = useState(b.waitingOn ?? "");
  const moves = b.status === "CLOSED" ? [] : BID_TRANSITIONS[b.status].filter((s) => s !== "CLOSED" && s !== b.status && !(s === "SUBMITTED" && b.submissions.length === 0));
  const label = (s: BidStatus) => options?.bidStatuses.find((o) => o.value === s)?.label ?? s;
  const platform = options?.bidPlatforms.find((o) => o.value === b.platform)?.label ?? b.platform;
  const flags = [b.specsReceived && "Specs received", b.siteVisitRequired && "Site visit required", b.bondRequired && "Bond required", b.prevailingWage && "Prevailing wage", b.unionRequired && "Union labor"].filter(Boolean) as string[];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="font-mono text-xs text-muted-foreground">{b.number}</span>
            {b.projectName}
            <BidStatusBadge status={b.status} label={b.statusLabel} outcome={b.outcome} />
          </CardTitle>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <Link href={`/partners/${b.organization.id}?tab=bids`} className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"><Building2 className="size-3.5" />{b.organization.name}</Link>
            {b.contact && <span>Invited by {b.contact.firstName} {b.contact.lastName}{b.contact.title ? `, ${b.contact.title}` : ""}</span>}
            <span>Estimator: {personName(b.estimator) ?? "not assigned"}</span>
          </p>
        </div>
        {p.canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="mr-1.5 size-3.5" />Edit</Button>
            {b.status !== "CLOSED" && moves.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={status.isPending} />}>Move to…</DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {moves.map((s) => (
                    <DropdownMenuItem key={s} onClick={() => status.mutate({ status: s })}>{label(s)}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {b.status !== "CLOSED" && <Button size="sm" variant="brand" onClick={onSubmit}><Send className="mr-1.5 size-3.5" />{b.submissions.length ? "Record a revision" : "Record submission"}</Button>}
            {b.status !== "CLOSED" && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>Close…</DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {p.canDecide && <DropdownMenuItem onClick={() => onClose("AWARDED")}><Trophy className="mr-2 size-4" />Awarded</DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => onClose("LOST")}><XCircle className="mr-2 size-4" />Lost</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onClose("CANCELLED")}>Cancelled by the GC</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onClose("NO_DECISION")}>No decision</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onClose("REBID")}>Rebid</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {b.status === "CLOSED" && p.canDecide && (
              <Button size="sm" variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate({ force: b.lead.jobs.length > 0 })}><RotateCcw className="mr-1.5 size-3.5" />Reopen</Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Fact label="Trades">{b.lead.trades.map((t) => t.name).join(", ") || "—"}</Fact>
          <Fact label="Estimated value">{usd(b.lead.estimatedJobValue)}</Fact>
          <Fact label="Latest price sent">{b.latestAmount == null ? "Not submitted" : usd(b.latestAmount)}</Fact>
          <Fact label="From">
            {b.platformUrl ? <a href={b.platformUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">{platform}<ExternalLink className="size-3" /></a> : platform}
            {b.platformRef && <span className="ml-1 text-muted-foreground">· {b.platformRef}</span>}
          </Fact>
          {b.projectType && <Fact label="Project type">{b.projectType}</Fact>}
          <Fact label="Estimating hours">{b.estimatingHours ?? "—"}</Fact>
          {b.addendaCount > 0 && <Fact label="Addenda">{b.addendaCount}</Fact>}
        </dl>
        {flags.length > 0 && <div className="flex flex-wrap gap-1.5">{flags.map((f) => <Badge key={f} variant="outline">{f}</Badge>)}</div>}
        {b.scopeSummary && <p className="whitespace-pre-wrap text-gray-700">{b.scopeSummary}</p>}
        {(b.insuranceNotes || b.scheduleNotes) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {b.insuranceNotes && <p className="text-xs text-muted-foreground"><span className="font-medium text-gray-700">Insurance: </span>{b.insuranceNotes}</p>}
            {b.scheduleNotes && <p className="text-xs text-muted-foreground"><span className="font-medium text-gray-700">Schedule: </span>{b.scheduleNotes}</p>}
          </div>
        )}
        {b.status === "ESTIMATING" && p.canManage && (
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); status.mutate({ status: "ESTIMATING", waitingOn }); }}>
            <div className="flex-1 space-y-1">
              <Label htmlFor="bid-waiting" className="text-xs">Waiting on</Label>
              <Input id="bid-waiting" value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)} placeholder="Supplier quote, sub pricing…" maxLength={200} />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={status.isPending || waitingOn === (b.waitingOn ?? "")}>Save</Button>
          </form>
        )}
        {b.status === "ESTIMATING" && !p.canManage && b.waitingOn && <p className="text-xs text-muted-foreground">Waiting on {b.waitingOn}</p>}
        <p className="text-xs text-muted-foreground">
          Work the estimate on this lead&apos;s Estimates and Plan takeoff tabs ({b.lead._count.estimates + b.lead._count.roofEstimates} estimate{b.lead._count.estimates + b.lead._count.roofEstimates === 1 ? "" : "s"}, {b.lead._count.planSets} plan set{b.lead._count.planSets === 1 ? "" : "s"}).
        </p>
      </CardContent>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

function DatesCard({ bid: b }: { bid: BidDetail }) {
  const rows: [string, string | null, boolean][] = [
    ["Bid due", when(b.bidDueAt), true],
    ["Site walk", when(b.siteWalkAt), false],
    ["Pre-bid meeting", when(b.preBidMeetingAt), false],
    ["RFI deadline", dayLabel(b.rfiDueAt), false],
    ["Addenda deadline", dayLabel(b.addendaDeadlineAt), false],
    ["Interview", when(b.interviewAt), false],
    ["Award expected", dayLabel(b.expectedAwardAt), false],
    ["Invited", dayLabel(b.invitedAt), false],
  ];
  const shown = rows.filter(([, v]) => v);
  const due = b.bidDueAt ? new Date(b.bidDueAt) : null;
  const overdue = due && b.status !== "CLOSED" && b.status !== "SUBMITTED" && b.status !== "SHORTLISTED" && due < new Date();
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><CalendarClock className="size-4" />Dates</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {shown.length === 0 ? (
          <p className="text-muted-foreground">No dates yet. Edit the bid to add the due date.</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {shown.map(([label, v, primary]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className={cn(primary && "font-medium", primary && overdue && "text-tone-danger-fg")}>
                  {v}
                  {primary && due && b.status !== "CLOSED" && <span className="ml-1 text-xs font-normal text-muted-foreground">({overdue ? `${formatDistanceToNowStrict(due)} ago` : `in ${formatDistanceToNowStrict(due)}`})</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Every date shows on the Calendar.</p>
      </CardContent>
    </Card>
  );
}

function DecisionCard({ bid: b }: { bid: BidDetail }) {
  const p = b.permissions;
  const stored = b.decisionFactors?.inputs as { manual?: Sliders } | undefined;
  const [sliders, setSliders] = useState<Sliders>(() => stored?.manual ?? { margin: null, capacity: null, competition: null, complexity: null, plansAndTerms: null });
  const [reason, setReason] = useState("");
  const [deciding, setDeciding] = useState(b.decision === "UNDECIDED" && b.status !== "CLOSED");
  const qs = useMemo(() => new URLSearchParams(Object.entries(sliders).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString(), [sliders]);
  const preview = useQuery<ScoreResult>({ queryKey: ["partners", "bid-score", b.id, qs, b.updatedAt], queryFn: () => fetchJson(`/api/bids/${b.id}/decision?${qs}`), retry: retryServerErrors, enabled: deciding, placeholderData: (prev) => prev });
  const decide = useBidAction(b.id, "/decision", (r: BidDetail) => (r.decision === "BID" ? "Decided to bid" : "Passed on this bid"));

  const decided = b.decision !== "UNDECIDED" && !deciding;
  const result: ScoreResult | null = decided && b.decisionFactors && b.decisionScore != null ? { ...b.decisionFactors, score: b.decisionScore } : (preview.data ?? null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><Gavel className="size-4" />Bid or pass</CardTitle>
        {decided && p.canDecide && b.status !== "CLOSED" && <Button size="sm" variant="ghost" onClick={() => setDeciding(true)}>Decide again</Button>}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {decided && (
          <p>
            <span className="font-medium">{b.decision === "BID" ? "Bidding" : "Passed"}</span>
            {b.decidedBy && <> · {personName(b.decidedBy)}</>}
            {b.decidedAt && <> · {format(new Date(b.decidedAt), "MMM d, yyyy")}</>}
            {b.decisionReason && <span className="block text-muted-foreground">{b.decisionReason}</span>}
          </p>
        )}
        {result && <ScoreView result={result} />}
        {!decided && !result && preview.isLoading && <p className="text-muted-foreground">Scoring…</p>}
        {!decided && b.status !== "CLOSED" && (
          <>
            <div className="space-y-2.5">
              {SLIDERS.map((s) => (
                <div key={s.key} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{s.label}<span className="ml-1 text-xs text-muted-foreground">({s.low} 1 – 5 {s.high})</span></span>
                  <div role="radiogroup" aria-label={s.label} className="inline-flex rounded-lg border bg-gray-50 p-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" role="radio" aria-checked={sliders[s.key] === n} disabled={!p.canDecide} onClick={() => setSliders((v) => ({ ...v, [s.key]: v[s.key] === n ? null : n }))} className={cn("h-7 w-8 rounded-md text-xs font-medium disabled:opacity-60", sliders[s.key] === n ? "bg-white shadow-sm" : "text-muted-foreground hover:text-gray-900")}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {p.canDecide ? (
              <>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={2000} placeholder="Why (kept with the decision)" aria-label="Reason" />
                <div className="flex flex-wrap gap-2">
                  <Button variant="brand" size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ decision: "BID", manual: sliders, reason }, { onSuccess: () => setDeciding(false) })}>Bid</Button>
                  <Button variant="outline" size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ decision: "NO_BID", manual: sliders, reason }, { onSuccess: () => setDeciding(false) })}>Pass (closes the bid)</Button>
                  {b.decision !== "UNDECIDED" && <Button variant="ghost" size="sm" onClick={() => setDeciding(false)}>Cancel</Button>}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">A manager decides; the sliders show how the score moves.</p>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">The score is advice from fixed rules (Admin → Business Development); a person decides.</p>
      </CardContent>
    </Card>
  );
}

function ScoreView({ result }: { result: ScoreResult }) {
  const tone = toneClasses(REC_TONE[result.recommendation]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-3xl font-semibold tabular-nums">{result.score}</span>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", tone.pill)}>{REC_LABEL[result.recommendation]}</span>
        <span className="text-xs text-muted-foreground">rules v{result.weightsVersion}</span>
      </div>
      {result.gates.length > 0 && <Callout tone="danger" title="Hard stops">{result.gates.join(" · ")}</Callout>}
      {result.reasons.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">For</p>
          <ul className="list-inside list-disc text-sm">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {result.concerns.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Concerns</p>
          <ul className="list-inside list-disc text-sm">{result.concerns.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">How it adds up</summary>
        <table className="mt-1 w-full">
          <tbody>
            {Object.entries(result.breakdown).map(([k, f]) => (
              <tr key={k} className="border-t">
                <td className="py-1 pr-2">{f.note}</td>
                <td className="py-1 text-right tabular-nums">{f.max > 0 ? `${f.points} / ${f.max}` : f.points !== 0 ? f.points : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function SubmissionsCard({ bid: b, onSubmit }: { bid: BidDetail; onSubmit: () => void }) {
  const { data: options } = useBidOptions();
  const kind = (k: SubmissionKind) => options?.submissionKinds.find((o) => o.value === k)?.label ?? k;
  const method = (m: SubmissionMethod) => options?.submissionMethods.find((o) => o.value === m)?.label ?? m;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><Send className="size-4" />What went out</CardTitle>
        {b.permissions.canManage && b.status !== "CLOSED" && b.submissions.length > 0 && <Button size="sm" variant="ghost" onClick={onSubmit}>Record a revision</Button>}
      </CardHeader>
      <CardContent className="text-sm">
        {b.submissions.length === 0 ? (
          <p className="text-muted-foreground">Nothing submitted yet. Record the price when it goes to the GC; each revision is kept.</p>
        ) : (
          <ul className="divide-y">
            {b.submissions.map((s) => {
              const margin = s.snapshotTotalPrice && s.snapshotSubtotalCost != null && s.snapshotTotalPrice > 0 ? (s.snapshotTotalPrice - s.snapshotSubtotalCost) / s.snapshotTotalPrice : null;
              return (
                <li key={s.id} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">v{s.version} · {usd(s.amount)} <span className="font-normal text-muted-foreground">({kind(s.kind)})</span></span>
                    <span className="text-xs text-muted-foreground">{format(new Date(s.submittedAt), "MMM d, yyyy")} · {method(s.method)} · {personName(s.submittedBy)}</span>
                  </div>
                  {margin !== null && <p className="text-xs text-muted-foreground">From an estimate at {usd(s.snapshotTotalPrice)} with {Math.round(margin * 100)}% margin when sent</p>}
                  {s.recipientContact && <p className="text-xs text-muted-foreground">To {personName(s.recipientContact)}</p>}
                  {s.clarifications && <p className="mt-1 whitespace-pre-wrap text-xs"><span className="font-medium">Clarifications: </span>{s.clarifications}</p>}
                  {s.exclusions && <p className="mt-1 whitespace-pre-wrap text-xs"><span className="font-medium">Exclusions: </span>{s.exclusions}</p>}
                  {s.alternates && <p className="mt-1 whitespace-pre-wrap text-xs"><span className="font-medium">Alternates: </span>{s.alternates}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OutcomeCard({ bid: b }: { bid: BidDetail }) {
  const { data: options } = useBidOptions();
  const reason = options?.lossReasons.find((o) => o.value === b.lossReason)?.label;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Trophy className="size-4" />Outcome</CardTitle></CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p className="flex items-center gap-2"><BidStatusBadge status="CLOSED" outcome={b.outcome} />{b.outcomeAt && <span className="text-muted-foreground">{format(new Date(b.outcomeAt), "MMM d, yyyy")}</span>}</p>
        {b.outcome === "AWARDED" && <p>Awarded at {usd(b.awardedAmount)}</p>}
        {reason && <p>Lost on {reason.toLowerCase()}</p>}
        {(b.winningContractor || b.winningPrice != null) && <p>Went to {b.winningContractor ?? "another contractor"}{b.winningPrice != null && ` at ${usd(b.winningPrice)}`}{b.winningPrice != null && b.latestAmount != null && <span className="text-muted-foreground"> ({usd(b.latestAmount - b.winningPrice)} apart)</span>}</p>}
        {b.outcomeNotes && <p className="whitespace-pre-wrap text-muted-foreground">{b.outcomeNotes}</p>}
        {b.lead.jobs.map((j) => (
          <p key={j.id}>
            <Link href={`/jobs/${j.id}`} className="font-medium text-blue-700 hover:underline">Job <span className="font-mono text-xs">{j.jobNumber}</span></Link>
            <span className="text-muted-foreground"> · {usd(j.contractAmount)} · {j.billingMethod === "PROGRESS" ? "progress billing" : j.billingMethod.toLowerCase()} · {j.currentStage?.name}</span>
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

type EstimateOption = { value: string; label: string; total: number };

function SubmissionDialog({ open, onOpenChange, bid: b }: { open: boolean; onOpenChange: (o: boolean) => void; bid: BidDetail }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">{open && <SubmissionForm bid={b} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function SubmissionForm({ bid: b, onClose }: { bid: BidDetail; onClose: () => void }) {
  const { data: options } = useBidOptions();
  const NONE = "__none";
  const templates = useQuery<{ id: string; estimateNumber: string; name: string; totalPrice: string | number }[]>({ queryKey: ["lead-template-estimates", b.leadId], queryFn: () => fetchJson(`/api/leads/${b.leadId}/template-estimates`), retry: retryServerErrors });
  const roofs = useQuery<{ id: string; estimateNumber: string; totalPrice: string | number }[]>({ queryKey: ["lead-roof-estimates", b.leadId], queryFn: () => fetchJson(`/api/leads/${b.leadId}/estimates`), retry: retryServerErrors });
  const estimateItems: EstimateOption[] = [
    ...(templates.data ?? []).map((e) => ({ value: `t:${e.id}`, label: `${e.estimateNumber} · ${e.name} · ${usd(Number(e.totalPrice))}`, total: Number(e.totalPrice) })),
    ...(roofs.data ?? []).map((e) => ({ value: `r:${e.id}`, label: `${e.estimateNumber} · roofing · ${usd(Number(e.totalPrice))}`, total: Number(e.totalPrice) })),
  ];
  const first = b.submissions.length === 0;
  const [form, setForm] = useState({ amount: "", estimate: NONE, kind: (first ? "ORIGINAL" : "REVISED") as SubmissionKind, method: (b.platform === "EMAIL" ? "EMAIL" : "PLATFORM") as SubmissionMethod, submittedAt: format(new Date(), "yyyy-MM-dd"), recipientContactId: b.contactId ?? NONE, clarifications: "", exclusions: "", alternates: "", estimatingHours: b.estimatingHours != null ? String(b.estimatingHours) : "" });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useBidAction(b.id, "/submissions", (r: BidDetail) => `${r.number} v${r.submissions[0]?.version ?? 1} recorded`);
  const contactItems = [{ value: NONE, label: "—" }, ...(b.contact ? [{ value: b.contact.id, label: `${b.contact.firstName} ${b.contact.lastName}` }] : [])];
  const estItems = [{ value: NONE, label: "None" }, ...estimateItems];
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          {
            amount: Number(form.amount),
            kind: form.kind,
            method: form.method,
            submittedAt: form.submittedAt,
            estimateId: form.estimate.startsWith("t:") ? form.estimate.slice(2) : null,
            roofEstimateId: form.estimate.startsWith("r:") ? form.estimate.slice(2) : null,
            recipientContactId: form.recipientContactId === NONE ? null : form.recipientContactId,
            clarifications: form.clarifications,
            exclusions: form.exclusions,
            alternates: form.alternates,
            estimatingHours: form.estimatingHours ? Number(form.estimatingHours) : null,
          },
          { onSuccess: onClose },
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>{first ? "Record the submission" : "Record a revision"}</DialogTitle>
        <DialogDescription>The price as it went to {b.organization.name}. It is kept as sent; a later change is a new version.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>From estimate</Label>
          <Select items={estItems} value={form.estimate} onValueChange={(v: string | null) => {
            const picked = estimateItems.find((e) => e.value === v);
            setForm((f) => ({ ...f, estimate: v ?? NONE, amount: picked && !f.amount ? String(picked.total) : f.amount }));
          }}>
            <SelectTrigger className="w-full" aria-label="Estimate"><SelectValue /></SelectTrigger>
            <SelectContent>{estItems.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Its price and cost are kept with the submission, so the margin at bid time survives later edits.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-amount">Amount</Label>
          <Input id="s-amount" type="number" min={0} step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-date">Sent</Label>
          <Input id="s-date" type="date" value={form.submittedAt} onChange={(e) => set("submittedAt", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Kind</Label>
          <Select items={options?.submissionKinds ?? []} value={form.kind} onValueChange={(v: SubmissionKind | null) => v && set("kind", v)}>
            <SelectTrigger className="w-full" aria-label="Kind"><SelectValue /></SelectTrigger>
            <SelectContent>{(options?.submissionKinds ?? []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>How</Label>
          <Select items={options?.submissionMethods ?? []} value={form.method} onValueChange={(v: SubmissionMethod | null) => v && set("method", v)}>
            <SelectTrigger className="w-full" aria-label="Method"><SelectValue /></SelectTrigger>
            <SelectContent>{(options?.submissionMethods ?? []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>To</Label>
          <Select items={contactItems} value={form.recipientContactId} onValueChange={(v: string | null) => set("recipientContactId", v ?? NONE)}>
            <SelectTrigger className="w-full" aria-label="Recipient"><SelectValue /></SelectTrigger>
            <SelectContent>{contactItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-hours">Estimating hours so far</Label>
          <Input id="s-hours" type="number" min={0} step="0.5" value={form.estimatingHours} onChange={(e) => set("estimatingHours", e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-clar">Clarifications</Label>
        <Textarea id="s-clar" rows={2} value={form.clarifications} onChange={(e) => set("clarifications", e.target.value)} maxLength={5000} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-excl">Exclusions</Label>
        <Textarea id="s-excl" rows={2} value={form.exclusions} onChange={(e) => set("exclusions", e.target.value)} maxLength={5000} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-alt">Alternates</Label>
        <Textarea id="s-alt" rows={2} value={form.alternates} onChange={(e) => set("alternates", e.target.value)} maxLength={5000} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="brand" disabled={!form.amount || save.isPending}>{save.isPending ? "Saving…" : "Record"}</Button>
      </DialogFooter>
    </form>
  );
}

function CloseDialog({ outcome, onOpenChange, bid: b }: { outcome: BidOutcome | null; onOpenChange: (o: boolean) => void; bid: BidDetail }) {
  return (
    <Dialog open={outcome !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{outcome && <CloseForm key={outcome} initial={outcome} bid={b} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function CloseForm({ initial, bid: b, onClose }: { initial: BidOutcome; bid: BidDetail; onClose: () => void }) {
  const { data: options } = useBidOptions();
  const [form, setForm] = useState({ outcome: initial, lossReason: "" as LossReason | "", winningContractor: "", winningPrice: "", awardedAmount: b.latestAmount != null ? String(b.latestAmount) : "", outcomeNotes: "", outcomeAt: format(new Date(), "yyyy-MM-dd") });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const close = useBidAction<{ bid: BidDetail; job: { id: string; jobNumber: string } | null }>(b.id, "/outcome", (r) => (r.job ? `Awarded — ${r.job.jobNumber} created` : "Bid closed"));
  const outcomes = (options?.bidOutcomes ?? []).filter((o) => o.value !== "NO_BID" && (o.value !== "AWARDED" || b.permissions.canDecide));
  const awarded = form.outcome === "AWARDED";
  const lost = form.outcome === "LOST";
  const ok = (!lost || form.lossReason) && (!awarded || Number(form.awardedAmount) > 0);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        close.mutate(
          { outcome: form.outcome, lossReason: lost ? form.lossReason : null, winningContractor: form.winningContractor, winningPrice: form.winningPrice ? Number(form.winningPrice) : null, awardedAmount: awarded ? Number(form.awardedAmount) : null, outcomeNotes: form.outcomeNotes, outcomeAt: form.outcomeAt },
          { onSuccess: onClose },
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Close {b.number}</DialogTitle>
        <DialogDescription>{awarded ? "Marks the lead Won and creates the job: progress billing, 10% retainage, no deposit." : "Records how it ended. The lead is marked Lost unless the bid is being rebid."}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Outcome</Label>
          <Select items={outcomes} value={form.outcome} onValueChange={(v: BidOutcome | null) => v && set("outcome", v)}>
            <SelectTrigger className="w-full" aria-label="Outcome"><SelectValue /></SelectTrigger>
            <SelectContent>{outcomes.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="o-date">Decided on</Label>
          <Input id="o-date" type="date" value={form.outcomeAt} onChange={(e) => set("outcomeAt", e.target.value)} />
        </div>
        {awarded && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="o-amount">Awarded amount</Label>
            <Input id="o-amount" type="number" min={0} step="0.01" value={form.awardedAmount} onChange={(e) => set("awardedAmount", e.target.value)} required />
            <p className="text-xs text-muted-foreground">Becomes the job&apos;s contract amount.</p>
          </div>
        )}
        {lost && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Why it was lost</Label>
            <Select items={options?.lossReasons ?? []} value={form.lossReason || null} onValueChange={(v: LossReason | null) => set("lossReason", v ?? "")}>
              <SelectTrigger className="w-full" aria-label="Loss reason"><SelectValue placeholder="Pick a reason" /></SelectTrigger>
              <SelectContent>{(options?.lossReasons ?? []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {!awarded && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="o-winner">Went to</Label>
              <Input id="o-winner" value={form.winningContractor} onChange={(e) => set("winningContractor", e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-price">Their price</Label>
              <Input id="o-price" type="number" min={0} step="0.01" value={form.winningPrice} onChange={(e) => set("winningPrice", e.target.value)} />
            </div>
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="o-notes">Notes</Label>
        <Textarea id="o-notes" rows={2} value={form.outcomeNotes} onChange={(e) => set("outcomeNotes", e.target.value)} maxLength={5000} placeholder="What the GC said" />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant={awarded ? "brand" : "default"} disabled={!ok || close.isPending}>{close.isPending ? "Saving…" : awarded ? "Award and create the job" : "Close the bid"}</Button>
      </DialogFooter>
    </form>
  );
}
