"use client";

import { useMemo, useState } from "react";
import { Activity, BadgeDollarSign, CalendarClock, ClipboardList, Clock, Gavel, Handshake, Percent, PiggyBank, Plus, Receipt, Scale, Trophy } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Callout } from "@/components/shared/callout";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { HttpError } from "@/lib/fetch-json";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { HEALTH_BAND_LABEL, HEALTH_BAND_TONE, useActionTask, useScorecard, type Health } from "./use-partners";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const SECTION_LABEL = { engagement: "Engagement", qualification: "Qualification", bidFlow: "Bid flow", economics: "Economics" } as const;

type Preset = "90d" | "12m" | "ytd" | "last-year" | "custom";

/** An account's performance: relationship health for everyone who sees the account, the money for office roles. */
export function PerformanceTab({ organizationId, health, canManage }: { organizationId: string; health: Health | null; canManage: boolean }) {
  const [preset, setPreset] = useState<Preset>("12m");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const qs = useMemo(() => new URLSearchParams(preset === "custom" ? { preset, from, to } : { preset }).toString(), [preset, from, to]);
  const card = useScorecard(organizationId, qs, preset !== "custom" || Boolean(from && to));
  const hidden = card.error instanceof HttpError && card.error.status === 403;

  return (
    <div className="space-y-4">
      {health && <HealthCard organizationId={organizationId} health={health} canManage={canManage} />}

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<Preset>
          ariaLabel="Window"
          size="sm"
          value={preset}
          onValueChange={setPreset}
          options={[
            { value: "90d", label: "90 days" },
            { value: "12m", label: "12 months" },
            { value: "ytd", label: "Year to date" },
            { value: "last-year", label: "Last year" },
            { value: "custom", label: "Custom" },
          ]}
        />
        {preset === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input type="date" aria-label="From" className="h-8 w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" aria-label="To" className="h-8 w-36" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
        {card.data && <span className="text-xs text-muted-foreground">{card.data.window.from} – {card.data.window.to}</span>}
      </div>

      {hidden ? (
        <Callout tone="info">Revenue, profit and payment figures are shown to office roles.</Callout>
      ) : card.isLoading ? (
        <ListSkeleton rows={3} />
      ) : card.isError ? (
        <Callout tone="danger" action={<Button size="sm" variant="outline" onClick={() => card.refetch()}>Try again</Button>}>{(card.error as Error).message}</Callout>
      ) : card.data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard title="Billed" value={usd(card.data.money.billed)} icon={Receipt} description={`${usd(card.data.money.collected)} collected`} />
            <KpiCard title="Projected gross profit" value={usd(card.data.money.grossProfit)} icon={PiggyBank} description={`${pct(card.data.money.margin)} margin across ${card.data.money.jobs} job${card.data.money.jobs === 1 ? "" : "s"}`} />
            <KpiCard
              title="Days to pay"
              value={card.data.money.daysToPay == null ? "—" : Math.round(card.data.money.daysToPay)}
              icon={Clock}
              tone={card.data.money.daysToPay != null && card.data.money.daysToPay > 60 ? "warning" : undefined}
              description={card.data.money.unlinkedPayments ? `${card.data.money.unlinkedPayments} payment${card.data.money.unlinkedPayments === 1 ? "" : "s"} without an invoice left out` : `${card.data.money.linkedPayments} payment${card.data.money.linkedPayments === 1 ? "" : "s"} measured`}
            />
            <KpiCard title="Retainage held" value={usd(card.data.money.retainageHeld)} icon={Scale} description={`Contracts ${usd(card.data.money.contractValue)} · average ${usd(card.data.money.averageContract)}`} />
            <KpiCard title="Invitations" value={card.data.bids.invitations} icon={Gavel} description={`${card.data.bids.submitted} submitted · bid rate ${pct(card.data.bids.bidRate)}`} />
            <KpiCard title="Win rate" value={pct(card.data.bids.winRate)} icon={Trophy} description={`${card.data.bids.awarded} won · ${card.data.bids.lost} lost${card.data.bids.priceGap != null ? ` · ${card.data.bids.priceGap >= 0 ? "+" : ""}${Math.round(card.data.bids.priceGap * 100)}% vs winners` : ""}`} />
            <KpiCard title="Awarded" value={usd(card.data.bids.awardedValue)} icon={BadgeDollarSign} description={`${usd(card.data.bids.openValue)} still in play`} />
            <KpiCard title="Turnaround" value={card.data.bids.avgTurnaroundDays == null ? "—" : `${card.data.bids.avgTurnaroundDays} d`} icon={CalendarClock} description="Invitation to submission" />
            <KpiCard title="Estimating hours" value={card.data.bids.estimatingHours} icon={ClipboardList} description={card.data.bids.perAwardHour != null ? `${usd(card.data.bids.perAwardHour)} profit per hour on awards` : "No profit per hour yet"} />
            <KpiCard title="Change orders approved" value={pct(card.data.money.changeOrderApprovalRate)} icon={Percent} description={`${card.data.money.changeOrdersDecided} decided`} />
            <KpiCard title="Touches" value={card.data.activity.interactions} icon={Activity} description={`${card.data.activity.outbound} out · ${card.data.activity.responses} back`} />
            <KpiCard title="Meetings" value={card.data.activity.meetings} icon={Handshake} description={card.data.money.repeatWork ? "Repeat work" : "No repeat work yet"} />
          </div>
          {Object.keys(card.data.bids.lossReasons).length > 0 && (
            <p className="text-xs text-muted-foreground">
              Losses: {Object.entries(card.data.bids.lossReasons).map(([k, n]) => `${k.toLowerCase()} ${n}`).join(" · ")}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Pick both dates.</p>
      )}
    </div>
  );
}

function HealthCard({ organizationId, health: h, canManage }: { organizationId: string; health: Health; canManage: boolean }) {
  const task = useActionTask(organizationId);
  const tone = toneClasses(HEALTH_BAND_TONE[h.band]);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-3 text-sm">
          Relationship health
          <span className="text-3xl font-semibold tabular-nums">{h.score}</span>
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", tone.pill)}>{HEALTH_BAND_LABEL[h.band]}</span>
          <span className="text-xs font-normal text-muted-foreground">rules v{h.weightsVersion}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(h.breakdown) as (keyof Health["breakdown"])[]).map((k) => {
            const s = h.breakdown[k];
            return (
              <div key={k}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-gray-700">{SECTION_LABEL[k]}</span>
                  <span className="tabular-nums text-muted-foreground">{s.points} / {s.max}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100" role="meter" aria-label={SECTION_LABEL[k]} aria-valuenow={s.points} aria-valuemin={0} aria-valuemax={s.max}>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${s.max ? (s.points / s.max) * 100 : 0}%` }} />
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {s.factors.map((f) => <li key={f.key}>{f.note} <span className="tabular-nums">({f.points}/{f.max})</span></li>)}
                </ul>
              </div>
            );
          })}
        </div>
        {h.capped && <Callout tone="warning">No touch in a long time: the score is held down until someone reaches out.</Callout>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Strengths</p>
            {h.strengths.length ? <ul className="list-inside list-disc">{h.strengths.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="text-muted-foreground">None yet</p>}
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Weaknesses</p>
            {h.weaknesses.length ? <ul className="list-inside list-disc">{h.weaknesses.slice(0, 5).map((s) => <li key={s}>{s}</li>)}</ul> : <p className="text-muted-foreground">None</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2">
          <p><span className="text-xs text-muted-foreground">Next: </span><span className="font-medium">{h.recommendedAction}</span></p>
          {canManage && (
            <Button size="sm" variant="outline" disabled={task.isPending || task.isSuccess} onClick={() => task.mutate(h.recommendedAction)}>
              <Plus className="mr-1 size-3.5" />{task.isSuccess ? "Task created" : "Create task"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Computed from fixed rules (Admin → Business Development → Weights); nothing here is a guess.</p>
      </CardContent>
    </Card>
  );
}
