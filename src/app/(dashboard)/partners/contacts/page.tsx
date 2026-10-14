"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { format, subDays } from "date-fns";
import { Download, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { useDebouncedValue } from "@/components/shared/use-debounced-value";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv, toCsv } from "@/lib/csv";
import { lastTouchLabel } from "@/lib/partners/derive";
import { cn } from "@/lib/utils";
import { ContactFormDialog } from "@/components/partners/contact-form-dialog";
import { PartnerStageBadge } from "@/components/partners/stage-badges";
import { useContactsAcross, useOrganizations, usePartnerOptions } from "@/components/partners/use-partners";

const ALL = "__all";

export default function ContactsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Contacts />
    </Suspense>
  );
}

function Contacts() {
  const url = useSearchParamState();
  const role = url.get("role") ?? "";
  const owner = url.get("owner") ?? "";
  const organizationId = url.get("organizationId") ?? "";
  const geography = url.get("geography") ?? "";
  const trade = url.get("trade") ?? "";
  const quiet = url.get("quiet") === "1";
  const [search, setSearch] = useState(url.get("q") ?? "");
  const q = useDebouncedValue(search.trim(), 300);
  const [adding, setAdding] = useState<string | null>(null);
  const [pickingAccount, setPickingAccount] = useState(false);

  const { data: options } = usePartnerOptions();
  const accounts = useOrganizations(new URLSearchParams({ pageSize: "500", sort: "name" }), pickingAccount || Boolean(organizationId));
  const params = useMemo(() => {
    const p = new URLSearchParams({ pageSize: "500" });
    if (q) p.set("search", q);
    if (role) p.set("role", role);
    if (owner) p.set("owner", owner);
    if (organizationId) p.set("organizationId", organizationId);
    if (geography) p.set("geography", geography);
    if (trade) p.set("trade", trade);
    if (quiet) p.set("quietSince", format(subDays(new Date(), 60), "yyyy-MM-dd"));
    return p;
  }, [q, role, owner, organizationId, geography, trade, quiet]);
  const list = useContactsAcross(params);
  const rows = list.data?.rows ?? [];
  const canManage = list.data?.canManage ?? false;
  const now = new Date();
  const activeFilterCount = [q, role, owner, organizationId, geography, trade, quiet ? "1" : ""].filter(Boolean).length;
  const roleLabel = (r: string) => options?.contactRoles.find((x) => x.value === r)?.label ?? r;

  const exportCsv = () =>
    downloadCsv(
      `gc-contacts-${format(now, "yyyy-MM-dd")}.csv`,
      toCsv(
        rows.map((c) => ({ name: `${c.firstName} ${c.lastName}`, title: c.title ?? "", role: roleLabel(c.roleTag), company: c.organization.name, phone: c.mobile || c.phone || "", email: c.email ?? "", geography: c.geography ?? "", trades: c.trades.join("; "), lastTouch: c.lastContactAt ? format(new Date(c.lastContactAt), "yyyy-MM-dd") : "", owner: c.organization.owner ? `${c.organization.owner.firstName} ${c.organization.owner.lastName}` : "" })),
        [
          { key: "name", header: "Name" },
          { key: "title", header: "Title" },
          { key: "role", header: "Role" },
          { key: "company", header: "Company" },
          { key: "phone", header: "Phone" },
          { key: "email", header: "Email" },
          { key: "geography", header: "Covers" },
          { key: "trades", header: "Trades" },
          { key: "lastTouch", header: "Last touch" },
          { key: "owner", header: "Account owner" },
        ],
      ),
    );

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="The estimators, preconstruction managers and executives at the accounts KNU courts."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}><Download className="mr-1.5 size-4" /> CSV</Button>
            {canManage && (
              <Button onClick={() => (organizationId ? setAdding(organizationId) : setPickingAccount(true))}><Plus className="mr-2 size-4" /> Add contact</Button>
            )}
          </>
        }
      />
      <ListToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          url.set("q", v.trim() || null);
        }}
        searchPlaceholder="Search people, titles, companies"
        activeFilterCount={activeFilterCount}
        onClearFilters={() => {
          setSearch("");
          url.setMany({ q: null, role: null, owner: null, organizationId: null, geography: null, trade: null, quiet: null });
        }}
        filters={
          <>
            <Filter label="Any role" value={role} onChange={(v) => url.set("role", v)} items={options?.contactRoles ?? []} width="w-44" />
            <Filter label="Any account owner" value={owner} onChange={(v) => url.set("owner", v)} items={options?.owners ?? []} width="w-44" />
            <Filter label="Any trade" value={trade} onChange={(v) => url.set("trade", v)} items={(options?.trades ?? []).map((t) => ({ value: t.label, label: t.label }))} width="w-36" />
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={quiet} onChange={(e) => url.set("quiet", e.target.checked ? "1" : null)} />
              No touch in 60 days
            </label>
          </>
        }
      />

      {list.isLoading ? (
        <ListSkeleton rows={8} />
      ) : list.isError ? (
        <EmptyState icon={Users} title="The contacts could not be loaded" description={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title={activeFilterCount ? "No contacts match" : "No contacts yet"} description={activeFilterCount ? "Try a different search or filter." : "Contacts are added on each account's Contacts tab."} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead className="hidden lg:table-cell">Email</TableHead>
                  <TableHead className="hidden lg:table-cell">Covers</TableHead>
                  <TableHead>Last touch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/partners/${c.organization.id}?tab=contacts&contact=${c.id}`} className="font-medium text-gray-900 hover:underline">{c.firstName} {c.lastName}</Link>
                      <div className="text-xs text-muted-foreground">{[c.title, roleLabel(c.roleTag)].filter(Boolean).join(" · ")}</div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/partners/${c.organization.id}`} className="hover:underline">{c.organization.name}</Link>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <PartnerStageBadge stage={c.organization.stage} />
                        {c.organization.owner && <span className="hidden sm:inline">{c.organization.owner.firstName} {c.organization.owner.lastName}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{(c.mobile || c.phone) ? <a href={`tel:${c.mobile || c.phone}`} className="hover:underline">{c.mobile || c.phone}</a> : "—"}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{c.email ? <a href={`mailto:${c.email}`} className="break-all hover:underline">{c.email}</a> : "—"}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{[c.geography, c.trades.join(", ")].filter(Boolean).join(" · ") || "—"}</TableCell>
                    <TableCell className={cn("whitespace-nowrap text-sm", !c.lastContactAt && "text-muted-foreground")}>{lastTouchLabel(c.lastContactAt, now)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {pickingAccount && (
        <Card className="mt-3">
          <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <span>Which account is the contact at?</span>
            <Select
              items={(accounts.data?.rows ?? []).map((o) => ({ value: o.id, label: o.name }))}
              onValueChange={(v: string | null) => {
                if (!v) return;
                setPickingAccount(false);
                setAdding(v);
              }}
            >
              <SelectTrigger className="h-8 w-64" aria-label="Account"><SelectValue placeholder="Pick an account" /></SelectTrigger>
              <SelectContent>{(accounts.data?.rows ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => setPickingAccount(false)}>Cancel</Button>
          </CardContent>
        </Card>
      )}
      {adding && <ContactFormDialog open onOpenChange={(o) => !o && setAdding(null)} organizationId={adding} />}
    </div>
  );
}

function Filter({ label, value, onChange, items, width }: { label: string; value: string; onChange: (v: string | null) => void; items: { value: string; label: string }[]; width: string }) {
  const all = [{ value: ALL, label }, ...items];
  return (
    <Select items={all} value={value || ALL} onValueChange={(v: string | null) => onChange(!v || v === ALL ? null : v)}>
      <SelectTrigger className={cn("h-8", width)} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{all.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}
