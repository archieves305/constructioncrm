"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Download, KanbanSquare, List, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { StagePillSelect } from "@/components/shared/stage-pill-select";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { useDebouncedValue } from "@/components/shared/use-debounced-value";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv, toCsv } from "@/lib/csv";
import { lastTouchLabel } from "@/lib/partners/derive";
import { stagesAsStageLike } from "@/lib/partners/stages";
import type { ListScope } from "@/lib/lists/scope";
import { cn } from "@/lib/utils";
import { OrgFormDialog } from "@/components/partners/org-form-dialog";
import { PartnerBoard } from "@/components/partners/partner-board";
import { OrgBadges, PriorityBadge } from "@/components/partners/stage-badges";
import { KIND_LABEL, useChangeStage, useOrganizations, usePartnerOptions, type OrgRow } from "@/components/partners/use-partners";
import { format } from "date-fns";

const ALL = "__all";
const STAGES = stagesAsStageLike();

export default function PartnersPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Partners />
    </Suspense>
  );
}

function Partners() {
  const url = useSearchParamState();
  const view = url.get("view") === "board" ? "board" : "table";
  const scope: ListScope = url.get("scope") === "mine" ? "mine" : "all";
  const stage = url.get("stage") ?? "";
  const owner = url.get("owner") ?? "";
  const market = url.get("market") ?? "";
  const trade = url.get("trade") ?? "";
  const kind = url.get("kind") ?? "";
  const inactive = url.get("inactive") === "1";
  const sort = url.get("sort") ?? "";
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebouncedValue(search.trim(), 300);
  const [creating, setCreating] = useState(false);

  const { data: options } = usePartnerOptions();
  const params = useMemo(() => {
    const p = new URLSearchParams({ pageSize: view === "board" ? "500" : "200", scope });
    if (q) p.set("search", q);
    if (stage) p.set("stage", stage);
    if (owner) p.set("owner", owner);
    if (market) p.set("market", market);
    if (trade) p.set("trade", trade);
    if (kind) p.set("kind", kind);
    if (inactive) p.set("inactive", "1");
    if (sort) p.set("sort", sort);
    return p;
  }, [view, scope, q, stage, owner, market, trade, kind, inactive, sort]);
  const list = useOrganizations(params);
  const rows = list.data?.rows ?? [];
  const canManage = list.data?.canManage ?? false;
  const canAdmin = list.data?.canAdmin ?? false;
  const activeFilterCount = [q, stage, owner, market, trade, kind, inactive ? "1" : ""].filter(Boolean).length;

  const exportCsv = () => {
    const now = new Date();
    const csv = toCsv(
      rows.map((r) => ({
        name: r.name,
        kind: KIND_LABEL[r.kind],
        stage: STAGES.find((s) => s.id === r.stage)?.name ?? r.stage,
        priority: r.priority ?? "",
        owner: r.owner ? `${r.owner.firstName} ${r.owner.lastName}` : "",
        primaryContact: r.primaryContact?.name ?? "",
        contactPhone: r.primaryContact?.phone ?? "",
        contactEmail: r.primaryContact?.email ?? "",
        lastTouch: r.lastContactAt ? format(new Date(r.lastContactAt), "yyyy-MM-dd") : "",
        quiet: lastTouchLabel(r.lastContactAt, now),
        nextTask: r.nextOpenTask?.title ?? "",
        markets: r.markets.join("; "),
        trades: r.trades.map((t) => t.name).join("; "),
        badges: r.badges.map((b) => b.label).join("; "),
      })),
      [
        { key: "name", header: "Account" },
        { key: "kind", header: "Kind" },
        { key: "stage", header: "Stage" },
        { key: "priority", header: "Priority" },
        { key: "owner", header: "Owner" },
        { key: "primaryContact", header: "Primary contact" },
        { key: "contactPhone", header: "Phone" },
        { key: "contactEmail", header: "Email" },
        { key: "lastTouch", header: "Last touch" },
        { key: "quiet", header: "Since" },
        { key: "nextTask", header: "Next task" },
        { key: "markets", header: "Markets" },
        { key: "trades", header: "Trades" },
        { key: "badges", header: "Status" },
      ],
    );
    downloadCsv(`gc-partners-${scope}-${format(now, "yyyy-MM-dd")}.csv`, csv);
  };

  return (
    <div>
      <PageHeader
        title="GC Partnerships"
        description="The general contractors and other accounts KNU courts for work: who owns each, where it stands, when it was last touched."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="mr-1.5 size-4" /> CSV
            </Button>
            {canManage && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 size-4" /> New account
              </Button>
            )}
          </>
        }
      />

      <ListToolbar
        scope={scope}
        onScopeChange={(s) => url.set("scope", s === "all" ? null : s)}
        mineLabel="My accounts"
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          url.set("q", v.trim() || null);
        }}
        searchPlaceholder="Search accounts, cities, contacts"
        activeFilterCount={activeFilterCount}
        onClearFilters={() => {
          setSearch("");
          url.setMany({ q: null, stage: null, owner: null, market: null, trade: null, kind: null, inactive: null });
        }}
        filters={
          <>
            <FilterSelect label="Any stage" value={stage} onChange={(v) => url.set("stage", v)} items={(options?.stages ?? []).map((s) => ({ value: s.value, label: s.label }))} width="w-36" />
            <FilterSelect label="Any owner" value={owner} onChange={(v) => url.set("owner", v)} items={options?.owners ?? []} width="w-40" />
            <FilterSelect label="Any market" value={market} onChange={(v) => url.set("market", v)} items={(options?.markets ?? []).map((m) => ({ value: m, label: m }))} width="w-36" />
            <FilterSelect label="Any trade" value={trade} onChange={(v) => url.set("trade", v)} items={options?.trades ?? []} width="w-36" />
            <FilterSelect label="Any kind" value={kind} onChange={(v) => url.set("kind", v)} items={options?.kinds ?? []} width="w-40" />
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={inactive} onChange={(e) => url.set("inactive", e.target.checked ? "1" : null)} />
              Show inactive
            </label>
          </>
        }
        trailing={
          <SegmentedControl
            ariaLabel="View"
            size="sm"
            value={view}
            onValueChange={(v) => url.set("view", v === "table" ? null : v)}
            options={[
              { value: "table", label: "Table", icon: List },
              { value: "board", label: "Board", icon: KanbanSquare },
            ]}
          />
        }
      />

      {list.isLoading ? (
        <ListSkeleton rows={8} />
      ) : list.isError ? (
        <EmptyState icon={Building2} title="The accounts could not be loaded" description={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        activeFilterCount > 0 || scope === "mine" ? (
          <EmptyState icon={Building2} title={scope === "mine" && activeFilterCount === 0 ? "You don't own any accounts yet" : "No accounts match"} description={scope === "mine" && activeFilterCount === 0 ? "An account lists you once you are its relationship owner." : "Try a different search or filter."} action={scope === "mine" ? <Button variant="outline" onClick={() => url.set("scope", null)}>Show all accounts</Button> : undefined} />
        ) : (
          <EmptyState icon={Building2} title="No GC accounts yet" description="Add the general contractors KNU wants to become a trade partner of. Each gets an owner, a stage and a last-touch date; the follow-up rules do the nagging." action={canManage ? <Button onClick={() => setCreating(true)}>Add the first account</Button> : undefined} />
        )
      ) : view === "board" ? (
        <PartnerBoard queryKey={["partners", "list", params.toString()]} rows={rows} isLoading={list.isLoading} canManage={canManage} canAdmin={canAdmin} resetKey={params.toString()} />
      ) : (
        <AccountsTable rows={rows} total={list.data?.total ?? rows.length} canManage={canManage} sort={sort} onSort={(s) => url.set("sort", s || null)} />
      )}

      <OrgFormDialog open={creating} onOpenChange={setCreating} canAdmin={canAdmin} />
    </div>
  );
}

function FilterSelect({ label, value, onChange, items, width }: { label: string; value: string; onChange: (v: string | null) => void; items: { value: string; label: string }[]; width: string }) {
  const all = [{ value: ALL, label }, ...items];
  return (
    <Select items={all} value={value || ALL} onValueChange={(v: string | null) => onChange(!v || v === ALL ? null : v)}>
      <SelectTrigger className={cn("h-8", width)} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{all.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function AccountsTable({ rows, total, canManage, sort, onSort }: { rows: OrgRow[]; total: number; canManage: boolean; sort: string; onSort: (s: string) => void }) {
  const now = new Date();
  const sortButton = (key: string, label: string) => (
    <button type="button" className={cn("font-medium hover:underline", sort === key && "text-gray-900")} onClick={() => onSort(sort === key ? "" : key)}>
      {label}
      {sort === key ? " ↓" : ""}
    </button>
  );
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{sortButton("name", "Account")}</TableHead>
              <TableHead>{sortButton("stage", "Stage")}</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead className="hidden lg:table-cell">Primary contact</TableHead>
              <TableHead>{sortButton("lastContact", "Last touch")}</TableHead>
              <TableHead className="hidden md:table-cell">Next task</TableHead>
              <TableHead className="hidden lg:table-cell">Markets</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <AccountRow key={r.id} row={r} now={now} canManage={canManage} />
            ))}
          </TableBody>
        </Table>
        {total > rows.length && <p className="border-t px-4 py-2 text-xs text-muted-foreground">Showing {rows.length} of {total} — narrow with search or a filter.</p>}
      </CardContent>
    </Card>
  );
}

function AccountRow({ row, now, canManage }: { row: OrgRow; now: Date; canManage: boolean }) {
  const change = useChangeStage(row.id);
  const quiet = row.badges.some((b) => b.key === "quiet" || b.key === "never-contacted");
  return (
    <TableRow className={row.isActive ? undefined : "opacity-60"}>
      <TableCell className="max-w-[18rem]">
        <div className="flex items-center gap-2">
          <Link href={`/partners/${row.id}`} className="truncate font-medium text-gray-900 hover:underline">{row.name}</Link>
          <PriorityBadge priority={row.priority} />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {[KIND_LABEL[row.kind], row.city, row.isActive ? null : "Inactive"].filter(Boolean).join(" · ")}
        </div>
        <OrgBadges badges={row.badges} max={2} className="mt-1" />
      </TableCell>
      <TableCell>
        <StagePillSelect
          value={row.stage}
          stages={STAGES}
          disabled={!canManage || change.isPending}
          onChange={(stage) => {
            if (stage === "DO_NOT_PURSUE") {
              const reason = window.prompt(`Why is ${row.name} not being pursued?`);
              if (!reason?.trim()) return;
              change.mutate({ stage: "DO_NOT_PURSUE", reason });
              return;
            }
            change.mutate({ stage: stage as OrgRow["stage"] });
          }}
        />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="flex items-center gap-1.5 text-sm">
          <UserAvatar user={row.owner} size="sm" />
          <span className="truncate">{row.owner ? `${row.owner.firstName} ${row.owner.lastName}` : <span className="text-muted-foreground">No owner</span>}</span>
        </span>
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        {row.primaryContact ? (
          <div className="text-sm">
            <div className="truncate">{row.primaryContact.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {row.primaryContact.title}
              {row.primaryContact.phone && (
                <>
                  {row.primaryContact.title ? " · " : ""}
                  <a href={`tel:${row.primaryContact.phone}`} className="hover:underline">{row.primaryContact.phone}</a>
                </>
              )}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{row.contactCount === 0 ? "No contacts" : `${row.contactCount} contact${row.contactCount === 1 ? "" : "s"}`}</span>
        )}
      </TableCell>
      <TableCell className={cn("whitespace-nowrap text-sm", quiet && "font-medium text-tone-warning-fg")}>{lastTouchLabel(row.lastContactAt, now)}</TableCell>
      <TableCell className="hidden max-w-[16rem] md:table-cell">
        {row.nextOpenTask ? (
          <Link href={`/tasks?task=${row.nextOpenTask.id}`} className="block truncate text-sm hover:underline" title={row.nextOpenTask.title}>
            {row.nextOpenTask.title}
            {row.nextOpenTask.dueAt && <span className="ml-1 text-xs text-muted-foreground">· {format(new Date(row.nextOpenTask.dueAt), "MMM d")}</span>}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{row.markets.slice(0, 3).join(", ")}{row.markets.length > 3 ? ` +${row.markets.length - 3}` : ""}</TableCell>
    </TableRow>
  );
}
