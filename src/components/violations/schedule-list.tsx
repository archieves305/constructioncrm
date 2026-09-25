"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { ClipboardCheck, Gavel } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { toneClasses } from "@/lib/ui/tones";
import { bucketOf, type DateBucket } from "@/lib/violations/dates";
import { cn } from "@/lib/utils";
import { HEARING_OUTCOME_LABEL, HEARING_TYPE_LABEL, INSPECTION_RESULT_TONE } from "./status";
import { useViolationSummary, violationKeys } from "./use-violations";

type Person = { id: string; firstName: string; lastName: string };
type CaseRef = { id: string; caseNumber: string; title: string; jurisdiction: string | null; status: string; caseManager: Person | null; lead: { propertyAddress1: string; city: string } };
type HearingRow = { id: string; type: string; status: string; scheduledAt: string; location: string | null; outcome: string | null; attendee: Person | null; case: CaseRef };
type InspectionRow = { id: string; kind: string; status: string; requestedAt: string; scheduledFor: string | null; result: string | null; inspectorName: string | null; attendee: Person | null; case: CaseRef };

const STATUS_OPTIONS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "pending", label: "Pending result" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

const BUCKETS: { key: DateBucket; title: string; tone: string }[] = [
  { key: "overdue", title: "Past", tone: "text-tone-danger-fg" },
  { key: "today", title: "Today", tone: "text-tone-warning-fg" },
  { key: "week", title: "This week", tone: "text-gray-900" },
  { key: "later", title: "Later", tone: "text-gray-700" },
  { key: "none", title: "Not yet scheduled", tone: "text-gray-500" },
];

/**
 * Hearings and agency inspections, date-first, for the two sidebar pages.
 * Child records, not cases, so the natural grouping is by date; filters
 * live in the URL. A row opens the case at the matching tab.
 */
export function ScheduleList({ kind }: { kind: "hearing" | "inspection" }) {
  const { get, setMany } = useSearchParamState();
  const status = get("status") ?? "upcoming";
  const from = get("from") ?? "";
  const to = get("to") ?? "";
  const jurisdiction = get("jurisdiction") ?? "";
  const assignedUserId = get("assignedUserId") ?? "";
  const qs = new URLSearchParams();
  qs.set("status", status);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (jurisdiction) qs.set("jurisdiction", jurisdiction);
  if (assignedUserId) qs.set("assignedUserId", assignedUserId);
  const path = kind === "hearing" ? "hearings" : "inspections";
  const { data: rows = [], isLoading, error } = useQuery<(HearingRow | InspectionRow)[]>({
    queryKey: violationKeys.schedule(path, qs.toString()),
    queryFn: () => fetchJson(`/api/violations/${path}?${qs.toString()}`),
    retry: retryServerErrors,
  });
  const { data: users = [] } = useAssignableUsers();
  const { data: summary } = useViolationSummary();
  const now = useMemo(() => new Date(), []);

  const dateOf = (r: HearingRow | InspectionRow): string | null => ("scheduledAt" in r ? r.scheduledAt : r.scheduledFor);
  const grouped = useMemo(() => {
    const g = new Map<DateBucket, (HearingRow | InspectionRow)[]>();
    for (const r of rows) {
      const d = dateOf(r);
      const b = bucketOf(d ? new Date(d) : null, now);
      g.set(b, [...(g.get(b) ?? []), r]);
    }
    return g;
  }, [rows, now]);
  const counts = { past: grouped.get("overdue")?.length ?? 0, today: grouped.get("today")?.length ?? 0, week: grouped.get("week")?.length ?? 0 };
  const Icon = kind === "hearing" ? Gavel : ClipboardCheck;

  return (
    <div>
      <PageHeader
        title={kind === "hearing" ? "Hearings" : "Agency inspections"}
        description={
          <span className="flex flex-wrap gap-1.5">
            {counts.past > 0 && <span className="rounded-full bg-tone-danger-soft px-2 py-0.5 text-[11px] font-medium text-tone-danger-fg">Past {counts.past}</span>}
            {counts.today > 0 && <span className="rounded-full bg-tone-warning-soft px-2 py-0.5 text-[11px] font-medium text-tone-warning-fg">Today {counts.today}</span>}
            <span className="rounded-full bg-tone-info-soft px-2 py-0.5 text-[11px] font-medium text-tone-info-fg">This week {counts.week}</span>
          </span>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="min-w-[150px]">
            <Label className="text-xs">Show</Label>
            <Select value={status} onValueChange={(v: string | null) => setMany({ status: v ?? "upcoming" })}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => STATUS_OPTIONS.find((o) => o.value === v)?.label ?? "Upcoming"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" className="mt-1" value={from} onChange={(e) => setMany({ from: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" className="mt-1" value={to} onChange={(e) => setMany({ to: e.target.value })} />
          </div>
          <div className="min-w-[180px]">
            <Label className="text-xs">Jurisdiction</Label>
            <Select value={jurisdiction || "__all"} onValueChange={(v: string | null) => setMany({ jurisdiction: !v || v === "__all" ? null : v })}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => (!v || v === "__all" ? "Any" : v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any</SelectItem>
                {(summary?.jurisdictions ?? []).map((j) => (
                  <SelectItem key={j} value={j}>
                    {j}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label className="text-xs">Attendee</Label>
            <AssigneePicker className="mt-1 w-full" value={assignedUserId || null} onChange={(id) => setMany({ assignedUserId: id })} users={users} placeholder="Anyone" />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : error ? (
        <Callout tone="danger" title={`Couldn't load the ${path}`}>{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : rows.length === 0 ? (
        <EmptyState icon={Icon} title={`No ${path} ${status === "upcoming" ? "coming up" : "match"}`} description={kind === "hearing" ? "Hearings are scheduled from a case's Hearings tab." : "Inspections are requested from a case's Inspections tab."} />
      ) : (
        <div className="space-y-4">
          {BUCKETS.filter((b) => (grouped.get(b.key)?.length ?? 0) > 0).map((b) => (
            <section key={b.key}>
              <h2 className={cn("mb-1.5 text-xs font-semibold uppercase tracking-wide", b.tone)}>
                {b.title} <span className="font-normal text-muted-foreground">({grouped.get(b.key)!.length})</span>
              </h2>
              <ul className="divide-y rounded-lg border bg-white">
                {grouped.get(b.key)!.map((r) => {
                  const d = dateOf(r);
                  const result = "outcome" in r ? r.outcome : r.result;
                  return (
                    <li key={r.id}>
                      <Link href={`/violations/${r.case.id}?tab=${path}#${kind}-${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-gray-50">
                        <span className="w-28 shrink-0 tabular-nums text-xs text-muted-foreground">{d ? format(new Date(d), "EEE MMM d · h:mm a") : "requested " + format(new Date((r as InspectionRow).requestedAt), "MMM d")}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {"type" in r ? HEARING_TYPE_LABEL[r.type] ?? r.type : r.kind.toLowerCase()}
                        </Badge>
                        <span className="font-mono text-brand-fg">{r.case.caseNumber}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {r.case.lead.propertyAddress1}, {r.case.lead.city}
                          {r.case.jurisdiction ? <span className="text-muted-foreground"> · {r.case.jurisdiction}</span> : null}
                        </span>
                        {"location" in r && r.location && <span className="hidden text-xs text-muted-foreground sm:inline">{r.location}</span>}
                        {"inspectorName" in r && r.inspectorName && <span className="hidden text-xs text-muted-foreground sm:inline">{r.inspectorName}</span>}
                        {result ? (
                          <Badge className={cn("border-0 text-[10px]", toneClasses(INSPECTION_RESULT_TONE[result] ?? "neutral").pill)}>{HEARING_OUTCOME_LABEL[result] ?? result}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            {r.status.toLowerCase()}
                          </Badge>
                        )}
                        <UserAvatar user={r.attendee ?? r.case.caseManager} size="xs" title={r.attendee ? "Attendee" : "Case manager"} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
