"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNowStrict } from "date-fns";
import { FolderKanban, Phone, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BID_OUTCOME_LABEL, BID_STATUS_LABEL } from "@/lib/partners/bid-state";
import { Pill } from "@/components/bids/pill";
import { NewProjectDialog } from "@/components/bids/project-dialogs";
import { personLabel, PRIME_LABEL, PRIME_TONE, QUEUE_HINT, QUEUE_LABEL, SCOPE_LABEL, SCOPE_TONE, usd, useQueue, useQueueCounts, type Opportunity, type Queue } from "@/components/bids/use-bid-projects";

const QUEUES: Queue[] = ["mine", "gc_awarded", "deadlines", "ready", "awaiting", "unassigned", "history"];

export default function PlanHubPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <PlanHub />
    </Suspense>
  );
}

function PlanHub() {
  const url = useSearchParamState();
  const raw = url.get("queue");
  const queue: Queue = QUEUES.includes(raw as Queue) ? (raw as Queue) : "mine";
  const search = url.get("q") ?? "";
  const [draft, setDraft] = useState(search);
  const [creating, setCreating] = useState(false);
  const params = useMemo(() => {
    const p = new URLSearchParams({ pageSize: "200" });
    if (search) p.set("search", search);
    return p;
  }, [search]);
  const list = useQueue(queue, params);
  const counts = useQueueCounts();
  const rows = list.data?.rows ?? [];

  return (
    <div>
      <PageHeader
        title="PlanHub Bids"
        breadcrumb={[{ label: "PlanHub Bids" }]}
        description="Every GC you sent a price to, tracked on its own: what to do next, what is due, and who has decided."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" render={<Link href="/planhub/projects" />} nativeButton={false}><FolderKanban className="mr-1.5 size-4" /> Projects</Button>
            {list.data?.canManage && <Button variant="brand" size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 size-4" /> New project</Button>}
          </div>
        }
      />
      <nav className="-mx-1 mb-3 flex gap-1 overflow-x-auto pb-1" aria-label="Queues">
        {QUEUES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => url.set("queue", q === "mine" ? null : q)}
            className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm", q === queue ? "border-brand bg-brand/10 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
            aria-current={q === queue ? "page" : undefined}
          >
            {QUEUE_LABEL[q]}
            {counts.data && <span className={cn("rounded-full px-1.5 text-2xs tabular-nums", q === "gc_awarded" && counts.data.counts[q] > 0 ? "bg-tone-danger-soft text-tone-danger-fg" : "bg-muted")}>{counts.data.counts[q]}</span>}
          </button>
        ))}
      </nav>
      <p className="mb-3 text-sm text-muted-foreground">{QUEUE_HINT[queue]}</p>
      <form onSubmit={(e) => { e.preventDefault(); url.set("q", draft.trim() || null); }} className="mb-3 sm:max-w-xs">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => url.set("q", draft.trim() || null)} placeholder="Search project, GC, number…" aria-label="Search" />
      </form>
      {list.isLoading ? (
        <ListSkeleton rows={6} />
      ) : list.isError ? (
        <EmptyState icon={FolderKanban} title="This list could not be loaded" description={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={FolderKanban} title="Nothing here" description={queue === "mine" ? "No open GC opportunities are yours. Start a project, or pick one up from Unassigned." : "Nothing in this queue right now."} />
      ) : (
        <div className="space-y-2">
          {rows.map((o) => <OpportunityRow key={o.id} o={o} queue={queue} />)}
        </div>
      )}
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function OpportunityRow({ o, queue }: { o: Opportunity; queue: Queue }) {
  const due = o.bidDueAt ? new Date(o.bidDueAt) : null;
  const late = due && due < new Date() && ["TRACKING", "INVITED", "DECIDING", "ESTIMATING", "READY_TO_SUBMIT"].includes(o.status);
  const next = o.nextActionAt ? new Date(o.nextActionAt) : null;
  const phone = o.contact?.mobile ?? o.contact?.phone ?? null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={o.bidProject ? `/planhub/projects/${o.bidProject.id}` : `/leads/${o.leadId}?tab=bid`} className="truncate font-medium hover:underline">{o.projectName}</Link>
            <span className="text-sm text-muted-foreground">· {o.organization.name}</span>
            <span className="font-mono text-2xs text-muted-foreground">{o.number}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={o.status === "CLOSED" ? "neutral" : "info"}>{o.status === "CLOSED" ? (o.outcome ? BID_OUTCOME_LABEL[o.outcome] : "Closed") : BID_STATUS_LABEL[o.status]}</Pill>
            {o.primeStatus !== "UNKNOWN" && <Pill tone={PRIME_TONE[o.primeStatus]}>{PRIME_LABEL[o.primeStatus]}</Pill>}
            {o.scopes.map((s) => <Pill key={s.id} tone={SCOPE_TONE[s.status]}>{s.scope.label}: {SCOPE_LABEL[s.status]}</Pill>)}
          </div>
          <p className="text-xs text-muted-foreground">
            {personLabel(o.owner)}
            {o.latestAmount != null && <> · sent {usd(o.latestAmount)}</>}
            {due && queue !== "history" && <span className={cn(late && "font-medium text-tone-danger-fg")}> · due to GC {format(due, "MMM d, h:mm a")}{late ? ` (${formatDistanceToNowStrict(due)} late)` : ""}</span>}
          </p>
          {next && queue !== "history" && <p className={cn("text-xs", next < new Date() ? "font-medium text-tone-danger-fg" : "text-foreground")}>Next: {o.nextActionLabel ?? "Follow up"} · {format(next, "EEE MMM d, h:mm a")}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {phone && <Button variant="outline" size="sm" render={<a href={`tel:${phone.replace(/[^\d+]/g, "")}`} />} nativeButton={false}><Phone className="mr-1.5 size-4" /> Call</Button>}
          <Button variant="outline" size="sm" render={<Link href={`/leads/${o.leadId}?tab=bid`} />} nativeButton={false}>Open</Button>
        </div>
      </CardContent>
    </Card>
  );
}
