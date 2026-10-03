"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Hammer, Plus, Search, Store, Tags } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { useDebouncedValue } from "@/components/shared/use-debounced-value";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { VendorFormDialog, type VendorFormValues } from "@/components/vendors/vendor-form-dialog";
import { LinkVendorDialog } from "@/components/vendors/link-vendor-dialog";
import { ComplianceBadge } from "@/components/vendors/compliance-badge";
import { ComplianceOwner } from "@/components/vendors/compliance-owner";
import { KIND_LABEL, usd, useUnmatched, type PayeeGroup, type VendorKind, type VendorLink, type VendorRow } from "@/components/vendors/use-vendors";

type Tab = "directory" | "unmatched";
type KindFilter = "all" | VendorKind;

/** What the create / link dialogs were opened from. */
type Pending = { link: VendorLink; initial: Partial<VendorFormValues>; what: string };

export default function VendorsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Vendors />
    </Suspense>
  );
}

function Vendors() {
  const url = useSearchParamState();
  const tab: Tab = url.get("tab") === "unmatched" ? "unmatched" : "directory";
  const kind = (["SUBCONTRACTOR", "SUPPLIER", "OTHER"].includes(url.get("kind") ?? "") ? url.get("kind") : "all") as KindFilter;
  const needs = url.get("needs") === "1";
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebouncedValue(search.trim());
  const [creating, setCreating] = useState<Pending | null>(null);
  const [linking, setLinking] = useState<Pending | null>(null);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (kind !== "all") params.set("kind", kind);
  if (needs) params.set("needs", "1");

  const list = useQuery<{ vendors: VendorRow[]; canManage: boolean }>({
    queryKey: ["vendors", "list", q, kind, needs],
    queryFn: () => fetchJson(`/api/vendors?${params.toString()}`),
    retry: retryServerErrors,
  });
  const unmatched = useUnmatched();
  const canManage = list.data?.canManage ?? false;
  const unmatchedCount = unmatched.data ? unmatched.data.payees.length + unmatched.data.crews.length + unmatched.data.contractLabels.length : null;

  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Subcontractors, crews and suppliers in one list. Expenses attach to a vendor by the payee name."
        actions={
          <>
            <ComplianceOwner />
            {canManage && (
              <Button onClick={() => setCreating({ link: {}, initial: {}, what: "" })}>
                <Plus className="mr-2 size-4" />
                New vendor
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel="View"
          value={tab}
          onValueChange={(v) => url.set("tab", v === "directory" ? null : v)}
          options={[
            { value: "directory", label: "Directory", icon: Store },
            { value: "unmatched", label: unmatchedCount ? `Unmatched · ${unmatchedCount}` : "Unmatched", icon: Tags },
          ]}
        />
        {tab === "directory" && (
          <>
            <SegmentedControl
              ariaLabel="Kind"
              value={kind}
              onValueChange={(v) => url.set("kind", v === "all" ? null : v)}
              options={[
                { value: "all", label: "All" },
                { value: "SUBCONTRACTOR", label: "Subcontractors" },
                { value: "SUPPLIER", label: "Suppliers" },
                { value: "OTHER", label: "Other" },
              ]}
            />
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={needs} onChange={(e) => url.set("needs", e.target.checked ? "1" : null)} />
              Needs documents
            </label>
            <div className="relative w-full sm:ml-auto sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors" className="pl-8" aria-label="Search vendors" />
            </div>
          </>
        )}
      </div>

      {tab === "directory" ? (
        <Directory
          query={list}
          filtered={Boolean(q) || kind !== "all" || needs}
          onNew={canManage ? () => setCreating({ link: {}, initial: {}, what: "" }) : undefined}
          onUnmatched={() => url.set("tab", "unmatched")}
          unmatchedCount={unmatchedCount ?? 0}
        />
      ) : (
        <UnmatchedTab query={unmatched} canManage={canManage} onCreate={setCreating} onLink={setLinking} />
      )}

      <VendorFormDialog
        open={Boolean(creating)}
        onOpenChange={(open) => !open && setCreating(null)}
        initial={creating?.initial}
        link={creating?.link}
        linkNote={creating?.what ? `${creating.what} will be linked to this vendor.` : undefined}
      />
      <LinkVendorDialog
        link={linking?.link ?? null}
        title="Link to a vendor"
        description={linking ? `${linking.what} will be linked to the vendor you pick.` : ""}
        onClose={() => setLinking(null)}
      />
    </div>
  );
}

function Directory({
  query,
  filtered,
  onNew,
  onUnmatched,
  unmatchedCount,
}: {
  query: ReturnType<typeof useQuery<{ vendors: VendorRow[]; canManage: boolean }>>;
  filtered: boolean;
  onNew?: () => void;
  onUnmatched: () => void;
  unmatchedCount: number;
}) {
  if (query.isLoading) return <ListSkeleton rows={8} />;
  if (query.isError) {
    return <EmptyState icon={Store} title="The vendor list could not be loaded" description={(query.error as Error).message} action={<Button variant="outline" onClick={() => query.refetch()}>Try again</Button>} />;
  }
  const vendors = query.data?.vendors ?? [];
  if (vendors.length === 0) {
    return filtered ? (
      <EmptyState icon={Store} title="No vendors match" description="Try a different search, kind or filter." />
    ) : (
      <EmptyState
        icon={Store}
        title="No vendors yet"
        description={unmatchedCount ? `${unmatchedCount} payees, crews and contractors are waiting on the Unmatched tab — turn them into vendors there.` : "Add the subcontractors and suppliers you work with."}
        action={
          <div className="flex gap-2">
            {unmatchedCount > 0 && <Button variant="outline" onClick={onUnmatched}>Open Unmatched</Button>}
            {onNew && <Button onClick={onNew}>New vendor</Button>}
          </div>
        }
      />
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="hidden md:table-cell">Contact</TableHead>
              <TableHead className="text-right">Spent</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Jobs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.map((v) => (
              <TableRow key={v.id}>
                <TableCell>
                  <Link href={`/vendors/${v.id}`} className="font-medium text-gray-900 hover:underline">{v.name}</Link>
                  {!v.isActive && <Badge variant="outline" className="ml-2">Inactive</Badge>}
                  {v.trade && <div className="text-xs text-muted-foreground">{v.trade}</div>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">{KIND_LABEL[v.kind]}</Badge>
                    {v.compliance.verdict !== "not_required" && <ComplianceBadge compliance={v.compliance} />}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="text-sm">{v.contactName || "—"}</div>
                  {v.phone && <a href={`tel:${v.phone}`} className="text-xs text-muted-foreground hover:underline">{v.phone}</a>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {usd(v.approvedSpend)}
                  <div className="text-xs text-muted-foreground">{v.expenseCount} expense{v.expenseCount === 1 ? "" : "s"}</div>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{v.jobCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function UnmatchedTab({
  query,
  canManage,
  onCreate,
  onLink,
}: {
  query: ReturnType<typeof useUnmatched>;
  canManage: boolean;
  onCreate: (p: Pending) => void;
  onLink: (p: Pending) => void;
}) {
  if (query.isLoading) return <ListSkeleton rows={8} />;
  if (query.isError) {
    return <EmptyState icon={Tags} title="The unmatched list could not be loaded" description={(query.error as Error).message} action={<Button variant="outline" onClick={() => query.refetch()}>Try again</Button>} />;
  }
  const data = query.data;
  if (!data || data.payees.length + data.crews.length + data.contractLabels.length === 0) {
    return <EmptyState icon={Tags} title="Everything has a vendor" description="Every crew, contractor and expense payee is linked to a vendor record." />;
  }

  const actions = (p: Pending) =>
    canManage && (
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => onLink(p)}>Link to…</Button>
        <Button size="sm" onClick={() => onCreate(p)}>New vendor</Button>
      </div>
    );

  return (
    <div className="space-y-6">
      {data.crews.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Hammer className="size-4" /> Crews without a vendor record</CardTitle>
            <p className="text-sm text-muted-foreground">A crew keeps working as it does today; the vendor record is where its insurance, W-9 and spend will live.</p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableBody>
                {data.crews.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{[c.trades.join(", "), `${c.contracts} labor contract${c.contracts === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</div>
                    </TableCell>
                    <TableCell>
                      {actions({
                        link: { crewId: c.id },
                        initial: { name: c.name, kind: "SUBCONTRACTOR", trade: c.trades.join(", "), phone: c.phone ?? "", email: c.email ?? "" },
                        what: `The crew "${c.name}"`,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.contractLabels.length > 0 && (
        <PayeeCard
          title="Contractors typed on labor contracts"
          hint="Labor contracts written under a typed name instead of a crew."
          rows={data.contractLabels}
          unit="labor contract"
          actions={(g) => actions({ link: { contractLabel: g.text }, initial: { name: g.text, kind: "SUBCONTRACTOR" }, what: `Labor contracts under "${g.text}"` })}
        />
      )}

      {data.payees.length > 0 && (
        <PayeeCard
          title="Expense payees"
          hint="Payee names on expenses that match no vendor. Linking one also catches every later expense that contains it — trim a bank memo down to the name before you add it."
          rows={data.payees}
          unit="expense"
          actions={(g) => actions({ link: { payee: g.text }, initial: { name: g.text, kind: "SUPPLIER" }, what: `Expenses paid to "${g.text}"` })}
        />
      )}
    </div>
  );
}

function PayeeCard({
  title,
  hint,
  rows,
  unit,
  actions,
}: {
  title: string;
  hint: string;
  rows: PayeeGroup[];
  unit: string;
  actions: (g: PayeeGroup) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableBody>
            {rows.map((g) => (
              <TableRow key={g.key}>
                <TableCell className="max-w-[16rem] whitespace-normal">
                  <div className="break-words font-medium">{g.text}</div>
                  <div className="text-xs text-muted-foreground">
                    {g.count} {unit}{g.count === 1 ? "" : "s"} · {g.jobs} job{g.jobs === 1 ? "" : "s"}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{usd(g.total)}</TableCell>
                <TableCell>{actions(g)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
