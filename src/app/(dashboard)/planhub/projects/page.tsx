"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { FolderKanban, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBidOptions } from "@/components/partners/use-partners";
import { Pill } from "@/components/bids/pill";
import { NewProjectDialog } from "@/components/bids/project-dialogs";
import { personLabel, PRIME_TONE, STAGE_LABEL, STAGE_TONE, useProjects } from "@/components/bids/use-bid-projects";

const ALL = "__all";

export default function ProjectsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Projects />
    </Suspense>
  );
}

function Projects() {
  const url = useSearchParamState();
  const search = url.get("q") ?? "";
  const stage = url.get("stage") ?? "active";
  const trade = url.get("trade") ?? "";
  const owner = url.get("owner") ?? "";
  const [draft, setDraft] = useState(search);
  const [creating, setCreating] = useState(false);
  const { data: options } = useBidOptions();
  const params = useMemo(() => {
    const p = new URLSearchParams({ pageSize: "200", stage });
    if (search) p.set("search", search);
    if (trade) p.set("trade", trade);
    if (owner) p.set("owner", owner);
    return p;
  }, [search, stage, trade, owner]);
  const list = useProjects(params);
  const rows = list.data?.rows ?? [];
  const stageItems = [{ value: "active", label: "Active" }, { value: "all", label: "All" }, ...(["OPEN", "PRIME_AWARDED", "POSTPONED", "REBIDDING", "CANCELLED", "CLOSED"] as const).map((s) => ({ value: s, label: STAGE_LABEL[s] }))];
  const tradeItems = [{ value: ALL, label: "Any trade" }, ...(options?.trades ?? [])];
  const ownerItems = [{ value: ALL, label: "Anyone" }, ...(options?.owners ?? [])];

  return (
    <div>
      <PageHeader
        title="Bid projects"
        breadcrumb={[{ label: "PlanHub Bids", href: "/planhub" }, { label: "Projects" }]}
        description="One row per job being bid, however many GCs are bidding it."
        actions={list.data?.canManage ? <Button variant="brand" size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 size-4" /> New project</Button> : undefined}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); url.set("q", draft.trim() || null); }} className="w-full sm:w-64">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => url.set("q", draft.trim() || null)} placeholder="Search name, address, PlanHub ID…" aria-label="Search projects" />
        </form>
        <Select items={stageItems} value={stage} onValueChange={(v: string | null) => url.set("stage", !v || v === "active" ? null : v)}>
          <SelectTrigger className="w-40" aria-label="Stage"><SelectValue /></SelectTrigger>
          <SelectContent>{stageItems.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select items={tradeItems} value={trade || ALL} onValueChange={(v: string | null) => url.set("trade", !v || v === ALL ? null : v)}>
          <SelectTrigger className="w-40" aria-label="Trade"><SelectValue /></SelectTrigger>
          <SelectContent>{tradeItems.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select items={ownerItems} value={owner || ALL} onValueChange={(v: string | null) => url.set("owner", !v || v === ALL ? null : v)}>
          <SelectTrigger className="w-44" aria-label="Owner"><SelectValue /></SelectTrigger>
          <SelectContent>{ownerItems.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {list.isLoading ? (
        <ListSkeleton rows={6} />
      ) : list.isError ? (
        <EmptyState icon={FolderKanban} title="The projects could not be loaded" description={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={FolderKanban} title={search ? "No project matches" : "No bid projects yet"} description="Start one when KNU decides to price a job on PlanHub." action={list.data?.canManage && !search ? <Button variant="brand" onClick={() => setCreating(true)}><Plus className="mr-1.5 size-4" />New project</Button> : undefined} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>GCs</TableHead>
                  <TableHead className="hidden md:table-cell">Next sub deadline</TableHead>
                  <TableHead className="hidden md:table-cell">Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="min-w-0">
                      <Link href={`/planhub/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span className="font-mono">{p.number}</span>{p.city && <span>· {p.city}</span>}<Pill tone={STAGE_TONE[p.stage]}>{STAGE_LABEL[p.stage]}</Pill></div>
                    </TableCell>
                    <TableCell className="text-sm">{p.scopes.map((s) => s.label).join(", ")}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">{p.gcs.map((g) => <Pill key={g.id} tone={g.status === "CLOSED" ? "neutral" : PRIME_TONE[g.primeStatus]}>{g.name}</Pill>)}</div>
                      <span className="text-xs text-muted-foreground">{p.openGcCount} of {p.gcCount} open</span>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{p.nextSubDueAt ? format(new Date(p.nextSubDueAt), "MMM d, h:mm a") : "—"}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{personLabel(p.owner)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
