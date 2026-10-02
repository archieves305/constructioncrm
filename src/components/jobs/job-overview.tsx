"use client";

import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleDollarSign, ClipboardCheck, FileText,
  Flag, HardHat, History, ListChecks, Paperclip, Receipt, ShieldCheck, Signature, Wallet, type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { toneClasses, type Tone } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import type { JobHealthLevel } from "@/lib/jobs/health";
import type { JobEventKind } from "@/lib/jobs/timeline";
import type { JobOverview as ServerOverview } from "@/lib/jobs/overview";

/** The loader's shape as it arrives over JSON: dates are ISO strings. */
type Wire<T> = T extends Date ? string : T extends (infer U)[] ? Wire<U>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;
type Overview = Wire<ServerOverview>;
type OverviewTask = Overview["tasks"]["toDoNow"][number];

const HEALTH_TONE: Record<JobHealthLevel, Tone> = {
  delayed: "danger",
  at_risk: "warning",
  on_track: "success",
  not_started: "neutral",
  closed: "neutral",
};

const EVENT_ICON: Record<JobEventKind, LucideIcon> = {
  stage: Flag,
  task: CheckCircle2,
  inspection: ClipboardCheck,
  payment: Wallet,
  expense: Receipt,
  labor_payment: HardHat,
  invoice: FileText,
  change_order: CircleDollarSign,
  permit: ShieldCheck,
  daily_log: HardHat,
  file: Paperclip,
  contract: Signature,
};

const money = (n: number) => { const r = Math.round(n); return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString("en-US")}`; };
const day = (iso: string) => format(new Date(iso), "MMM d");
/** A date-picker value (midnight UTC) is a day, not an instant: read it in UTC so it does not slip back a day. */
const utcDay = (iso: string) => format(new Date(`${iso.slice(0, 10)}T12:00:00`), "MMM d, yyyy");
const humanize = (s: string) => {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * The job on one screen: how it is doing and why, what is next, what is in
 * the way, where the permit and the money stand, and what happened lately.
 * Every block links to the tab that owns the detail.
 */
export function JobOverview({ jobId, onNavigate }: { jobId: string; onNavigate: (tab: string, sub?: string) => void }) {
  const { data, isLoading, error, refetch } = useQuery<Overview>({
    // Under ["job", id] so every invalidation of the job refreshes this too.
    queryKey: ["job", jobId, "overview"],
    queryFn: () => fetchJson<Overview>(`/api/jobs/${jobId}/overview`),
    retry: retryServerErrors,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <Callout tone="danger" title="Couldn't load the overview" action={<button type="button" className="text-sm underline" onClick={() => refetch()}>Try again</button>}>
        {(error as Error | null)?.message ?? "The server did not answer."}
      </Callout>
    );
  }

  const { health, workflow, tasks, money: m, permits, nextInspection, timeline } = data;
  const tone = toneClasses(HEALTH_TONE[health.level]);
  const attention = attentionRows(data);

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className={cn("rounded-lg px-4 py-3", tone.soft)}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={cn("inline-flex items-center gap-1.5 text-base font-semibold", tone.text)}>
            <span className={cn("size-2.5 rounded-full", tone.dot)} aria-hidden />
            {health.label}
          </span>
          <span className="text-sm text-gray-700">
            {data.stage.name} · {data.stage.daysInStage === 0 ? "since today" : `${data.stage.daysInStage} day${data.stage.daysInStage === 1 ? "" : "s"} in this stage`}
          </span>
          <span className="text-sm text-gray-600">
            PM: {data.projectManager ?? "not set"}
            {data.targetStartDate ? ` · Starts ${utcDay(data.targetStartDate)}` : ""}
          </span>
        </div>
        {health.reasons.length > 0 && (
          <p className={cn("mt-1 text-sm", tone.text)}>{sentence(health.reasons)}</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Next up */}
        <Block title="Next up" icon={ListChecks} action={{ label: workflow ? "Open workflow" : "Open tasks", onClick: () => onNavigate(workflow ? "workflow" : "tasks") }}>
          {workflow ? (
            <div className="mb-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-gray-900">{workflow.currentPhase ?? "All steps done"}</span>
                <span className="tabular-nums text-muted-foreground">{workflow.done}/{workflow.total} steps · {workflow.percentComplete}%</span>
              </div>
              <Progress value={workflow.percentComplete} className="mt-1.5 h-1.5" />
            </div>
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">No workflow on this job yet.</p>
          )}
          {tasks.toDoNow.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is ready to work on.</p>
          ) : (
            <TaskList rows={tasks.toDoNow} />
          )}
          {tasks.open > tasks.toDoNow.length && (
            <p className="mt-2 text-xs text-muted-foreground">{tasks.open} open in all{tasks.overdue > 0 ? ` · ${tasks.overdue} overdue` : ""}</p>
          )}
        </Block>

        {/* Needs attention */}
        <Block title="Needs attention" icon={AlertTriangle}>
          {attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is blocked, overdue or waiting on a decision.</p>
          ) : (
            <ul className="space-y-1.5">
              {attention.map((a) => (
                <li key={a.key}>
                  <button type="button" onClick={() => onNavigate(a.tab, a.sub)} className="group flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-gray-50">
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", toneClasses(a.tone).dot)} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="text-gray-900">{a.title}</span>
                      {a.detail && <span className="block truncate text-xs text-muted-foreground">{a.detail}</span>}
                    </span>
                    <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-gray-300 group-hover:text-gray-500" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Block>

        {/* Permits and inspections */}
        <Block title="Permits and inspections" icon={ShieldCheck} action={{ label: "Open permits", onClick: () => onNavigate("permits") }}>
          <dl className="space-y-2 text-sm">
            <Row label="Next inspection">
              {nextInspection?.scheduledFor
                ? `${humanize(nextInspection.type)} · ${format(new Date(nextInspection.scheduledFor), "EEE MMM d")}${nextInspection.inspectorName ? ` · ${nextInspection.inspectorName}` : ""}`
                : "None scheduled"}
            </Row>
            {workflow && permits.length === 0 && (
              <Row label="Permit">{workflow.permitStatus === "NOT_REQUIRED" ? "Not required" : workflow.permitStatus === "REQUIRED" ? "Required — none on file yet" : "Not decided yet"}</Row>
            )}
            {permits.map((p) => (
              <Row key={p.id} label={p.type ?? "Permit"}>
                <span>{humanize(p.status)}{p.number ? ` · #${p.number}` : ""} · {p.municipality}</span>
                {p.expirationDate && p.expiresInDays !== null && (
                  <span className={cn("block text-xs", p.expiresInDays < 0 ? "text-tone-danger-fg" : p.expiresInDays <= 30 ? "text-tone-warning-fg" : "text-muted-foreground")}>
                    {p.expiresInDays < 0 ? `Expired ${utcDay(p.expirationDate)}` : `Expires ${utcDay(p.expirationDate)}`}
                  </span>
                )}
              </Row>
            ))}
          </dl>
        </Block>

        {/* Money */}
        <Block title="Money" icon={CircleDollarSign} action={{ label: "Open money", onClick: () => onNavigate("money") }}>
          <dl className="space-y-2 text-sm">
            {m.billable && <Row label="Contract">{money(m.contract)}</Row>}
            {m.billable && <Row label="Paid">{money(m.paid)}{m.balanceDue > 0 ? <span className="text-muted-foreground"> · {money(m.balanceDue)} due</span> : null}</Row>}
            <Row label="Cost to date">
              {money(m.cost)}
              <span className="block text-xs text-muted-foreground">
                {[
                  m.costBreakdown.contractLabor ? `${money(m.costBreakdown.contractLabor)} labor contracts${m.committedOpen > 0 ? ` (${money(m.committedOpen)} not yet paid)` : ""}` : null,
                  m.costBreakdown.fieldLabor ? `${money(m.costBreakdown.fieldLabor)} field labor` : null,
                  m.costBreakdown.expenses ? `${money(m.costBreakdown.expenses)} expenses` : null,
                ].filter(Boolean).join(" · ") || "No costs recorded yet"}
              </span>
            </Row>
            {m.estimatedCost !== null && (
              <Row label="Estimated cost">
                <span className={m.overBudgetBy > 0 ? "text-tone-danger-fg" : undefined}>{money(m.estimatedCost)}</span>
                {m.overBudgetBy > 0 && <span className="block text-xs text-tone-danger-fg">Costs are {money(m.overBudgetBy)} over it</span>}
              </Row>
            )}
            {m.projectedProfit !== null && (
              <Row label="Projected profit">
                <span className={m.projectedProfit < 0 ? "text-tone-danger-fg" : undefined}>
                  {money(m.projectedProfit)}{m.projectedMargin !== null ? ` · ${Math.round(m.projectedMargin * 100)}%` : ""}
                </span>
              </Row>
            )}
            {m.projectedProfit === null && m.profit !== null && (
              <Row label="Profit so far">
                <span className={m.profit < 0 ? "text-tone-danger-fg" : undefined}>
                  {money(m.profit)}{m.margin !== null ? ` · ${Math.round(m.margin * 100)}%` : ""}
                </span>
                <span className="block text-xs text-muted-foreground">Contract less cost to date — not a forecast</span>
              </Row>
            )}
          </dl>
        </Block>
      </div>

      {/* Also due this week — beyond what "Next up" already lists */}
      {tasks.next7.length > 0 && (
        <Block title="Also due in the next 7 days" icon={CalendarClock} action={{ label: "Open tasks", onClick: () => onNavigate("tasks") }}>
          <TaskList rows={tasks.next7} />
        </Block>
      )}

      {/* Activity */}
      <Block title="Recent activity" icon={History}>
        {timeline.length === 0 ? (
          <EmptyState icon={History} title="No activity yet" description="Stage changes, completed tasks, payments, permits and daily logs will appear here." className="py-6" />
        ) : (
          <ol className="space-y-2.5">
            {timeline.map((e) => {
              const Icon = EVENT_ICON[e.kind];
              const body = (
                <>
                  <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-gray-900">{e.title}</span>
                    <span className="block text-xs text-muted-foreground" title={format(new Date(e.at), "PPp")}>
                      {formatDistanceToNowStrict(new Date(e.at), { addSuffix: true })}{e.actor ? ` · ${e.actor}` : ""}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={e.id}>
                  {e.tab ? (
                    <button type="button" onClick={() => onNavigate(e.tab!, e.sub ?? undefined)} className="flex w-full items-start gap-2.5 rounded-md px-1 py-0.5 text-left hover:bg-gray-50">
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2.5 px-1 py-0.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Block>
    </div>
  );
}

type AttentionRow = { key: string; tone: Tone; title: string; detail?: string; tab: string; sub?: string };

/** Everything in the way or waiting on someone, worst first. */
function attentionRows(d: Overview): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const t of d.tasks.blockers) {
    rows.push({
      key: `blocked:${t.id}`,
      tone: "danger",
      title: t.failedInspection ? `Failed inspection: ${t.title}` : `Blocked: ${t.title}`,
      detail: [t.blockedReason, t.assignee].filter(Boolean).join(" · ") || undefined,
      tab: t.isStep ? "workflow" : "tasks",
    });
  }
  for (const p of d.permits) {
    if (p.expiresInDays === null || p.expiresInDays > 30 || p.status === "FINAL" || p.status === "DENIED") continue;
    rows.push({
      key: `permit:${p.id}`,
      tone: p.expiresInDays < 0 ? "danger" : "warning",
      title: p.expiresInDays < 0 ? `${p.type ?? "Permit"} has expired` : `${p.type ?? "Permit"} expires in ${p.expiresInDays} day${p.expiresInDays === 1 ? "" : "s"}`,
      detail: p.municipality,
      tab: "permits",
    });
  }
  for (const t of d.tasks.overdueList) {
    if (t.status === "BLOCKED") continue;
    rows.push({
      key: `overdue:${t.id}`,
      tone: "warning",
      title: `Overdue: ${t.title}`,
      detail: [t.dueAt ? `due ${day(t.dueAt)}` : null, t.assignee ?? "unassigned"].filter(Boolean).join(" · "),
      tab: t.isStep ? "workflow" : "tasks",
    });
  }
  if (d.tasks.overdue > d.tasks.overdueList.length) {
    rows.push({ key: "overdue-more", tone: "warning", title: `${d.tasks.overdue - d.tasks.overdueList.length} more overdue`, tab: "tasks" });
  }
  if (d.workflow && d.workflow.unassigned > 0) {
    rows.push({ key: "unassigned", tone: "warning", title: `${d.workflow.unassigned} active step${d.workflow.unassigned === 1 ? " has" : "s have"} no owner`, tab: "workflow" });
  }
  if (!d.projectManager && d.health.level !== "closed") {
    rows.push({ key: "no-pm", tone: "warning", title: "No project manager on this job", detail: "Set one under Edit team on the Workflow tab", tab: "workflow" });
  }
  const m = d.money;
  if (m.overBudgetBy > 0) {
    rows.push({ key: "over-budget", tone: "danger", title: `Costs are ${money(m.overBudgetBy)} over the estimated cost`, detail: `${money(m.cost)} against ${money(m.estimatedCost ?? 0)}`, tab: "money", sub: "budget" });
  }
  if (m.changeOrdersAwaiting.count > 0) {
    rows.push({
      key: "co",
      tone: "info",
      title: `${m.changeOrdersAwaiting.count} change order${m.changeOrdersAwaiting.count === 1 ? "" : "s"} awaiting the customer`,
      detail: `${money(m.changeOrdersAwaiting.total)} not yet approved`,
      tab: "money",
      sub: "change-orders",
    });
  }
  if (m.pendingExpenses.count > 0) {
    rows.push({
      key: "pending-expenses",
      tone: "info",
      title: `${m.pendingExpenses.count} expense${m.pendingExpenses.count === 1 ? "" : "s"} waiting for approval`,
      detail: `${money(m.pendingExpenses.total)} not yet counted in cost`,
      tab: "money",
      sub: "expenses",
    });
  }
  if (d.field.crewPaymentRequests.count > 0) {
    const n = d.field.crewPaymentRequests.count;
    rows.push({
      key: "crew-requests",
      tone: "warning",
      title: `${n} crew payment request${n === 1 ? "" : "s"} waiting to be paid`,
      detail: money(d.field.crewPaymentRequests.total),
      tab: "field",
      sub: "labor",
    });
  }
  if (d.field.dailyLogsAwaitingApproval > 0) {
    rows.push({
      key: "logs",
      tone: "info",
      title: `${d.field.dailyLogsAwaitingApproval} daily log${d.field.dailyLogsAwaitingApproval === 1 ? "" : "s"} waiting for approval`,
      tab: "field",
      sub: "daily-logs",
    });
  }
  if (m.billable && m.depositRequired > 0 && m.depositReceived < m.depositRequired && d.health.level !== "closed") {
    rows.push({
      key: "deposit",
      tone: "info",
      title: "Deposit not fully received",
      detail: `${money(m.depositReceived)} of ${money(m.depositRequired)}`,
      tab: "money",
      sub: "payments",
    });
  }
  return rows;
}

function sentence(reasons: string[]): string {
  const s = reasons.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

function Block({ title, icon: Icon, action, children }: { title: string; icon: LucideIcon; action?: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {title}
        </CardTitle>
        {action && (
          <button type="button" onClick={action.onClick} className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
            {action.label} <ArrowRight className="size-3" aria-hidden />
          </button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-gray-900">{children}</dd>
    </div>
  );
}

function TaskList({ rows }: { rows: OverviewTask[] }) {
  return (
    <ul className="space-y-1.5">
      {rows.map((t) => (
        <li key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-gray-900">{t.title}</span>
          <span className={cn("shrink-0 text-xs", t.overdue ? "text-tone-danger-fg" : "text-muted-foreground")}>
            {[t.assignee ?? "Unassigned", t.dueAt ? (t.overdue ? `was due ${day(t.dueAt)}` : `due ${day(t.dueAt)}`) : "no date"].join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
