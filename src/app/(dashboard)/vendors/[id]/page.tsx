"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Mail, MapPin, Pencil, Phone, Plus, Store, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { JobRef } from "@/components/shared/entity-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import { VendorFormDialog } from "@/components/vendors/vendor-form-dialog";
import { ComplianceCard } from "@/components/vendors/compliance-card";
import { ComplianceBadge } from "@/components/vendors/compliance-badge";
import { KIND_LABEL, usd, type VendorDetail } from "@/components/vendors/use-vendors";

export default function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState("");

  const { data, isLoading, error, refetch } = useQuery<VendorDetail>({
    queryKey: ["vendors", "detail", id],
    queryFn: () => fetchJson(`/api/vendors/${id}`),
    retry: retryServerErrors,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["vendors"] });

  const addAlias = useMutation({
    mutationFn: (text: string) =>
      fetchJson<{ linked: number }>(`/api/vendors/${id}/aliases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }),
    onSuccess: (r) => {
      setAlias("");
      refresh();
      toast.success(r.linked ? `Added — ${r.linked} expense${r.linked === 1 ? "" : "s"} linked` : "Added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeAlias = useMutation({
    mutationFn: (aliasId: string) => fetchJson(`/api/vendors/${id}/aliases?aliasId=${aliasId}`, { method: "DELETE" }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const setActive = useMutation({
    mutationFn: (isActive: boolean) =>
      fetchJson(`/api/vendors/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const crumbs = [{ label: "Vendors", href: "/vendors" }, { label: data?.vendor.name ?? "Vendor" }];

  if (isLoading) return <ListSkeleton rows={8} />;
  if (error || !data) {
    const missing = error instanceof HttpError && error.status === 404;
    return (
      <div>
        <PageHeader title="Vendor" breadcrumb={crumbs} />
        <EmptyState
          icon={Store}
          title={missing ? "Vendor not found" : "This vendor could not be loaded"}
          description={missing ? "It may have been removed." : (error as Error | null)?.message}
          action={!missing && <Button variant="outline" onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  const { vendor, canManage } = data;
  const contractTotal = data.laborContracts.reduce((s, c) => s + c.amount, 0);
  const contractPaid = data.laborContracts.reduce((s, c) => s + c.paid, 0);

  return (
    <div>
      <PageHeader
        title={vendor.name}
        breadcrumb={crumbs}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{KIND_LABEL[vendor.kind]}</Badge>
            {vendor.trade && <span>{vendor.trade}</span>}
            {data.compliance.verdict !== "not_required" && <ComplianceBadge compliance={data.compliance} />}
            {!vendor.isActive && <Badge variant="outline">Inactive</Badge>}
          </span>
        }
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => setActive.mutate(!vendor.isActive)} disabled={setActive.isPending}>
                {vendor.isActive ? "Mark inactive" : "Mark active"}
              </Button>
              <Button onClick={() => setEditing(true)}>
                <Pencil className="mr-2 size-4" />
                Edit
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Contact</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {vendor.contactName && <div className="font-medium">{vendor.contactName}</div>}
              {vendor.phone && <a href={`tel:${vendor.phone}`} className="flex items-center gap-2 hover:underline"><Phone className="size-4 text-muted-foreground" />{vendor.phone}</a>}
              {vendor.email && <a href={`mailto:${vendor.email}`} className="flex items-center gap-2 break-all hover:underline"><Mail className="size-4 shrink-0 text-muted-foreground" />{vendor.email}</a>}
              {vendor.address && <div className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />{vendor.address}</div>}
              {!vendor.contactName && !vendor.phone && !vendor.email && !vendor.address && <p className="text-muted-foreground">No contact details yet.</p>}
              {vendor.notes && <p className="whitespace-pre-wrap border-t pt-2 text-muted-foreground">{vendor.notes}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payee names</CardTitle>
              <p className="text-sm text-muted-foreground">An expense whose payee contains the vendor&rsquo;s name or one of these attaches here automatically.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{vendor.name.toLowerCase()}</Badge>
                {vendor.aliases.map((a) => (
                  <Badge key={a.id} variant="outline" className="gap-1">
                    {a.pattern}
                    {canManage && (
                      <button type="button" aria-label={`Remove ${a.pattern}`} onClick={() => removeAlias.mutate(a.id)} className="rounded-full hover:bg-gray-200">
                        <X className="size-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
              {canManage && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (alias.trim()) addAlias.mutate(alias.trim());
                  }}
                >
                  <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="homedepot" aria-label="Another payee name" />
                  <Button type="submit" variant="outline" disabled={!alias.trim() || addAlias.isPending}>
                    <Plus className="mr-1 size-4" />
                    Add
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {vendor.crews.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Crews</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {vendor.crews.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.trades.join(", ")}{c.isActive ? "" : " · inactive"}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-2">
          <ComplianceCard
            vendorId={vendor.id}
            compliance={data.compliance}
            documents={data.documents}
            canManage={canManage}
            isSubcontractor={vendor.kind === "SUBCONTRACTOR"}
          />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Spent (approved expenses)" value={usd(data.approvedSpend)} />
            <Stat label="Labor contracts" value={usd(contractTotal)} sub={data.laborContracts.length ? `${usd(contractPaid)} paid` : undefined} />
          </div>

          {data.laborContracts.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Labor contracts</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead className="text-right">Contract</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.laborContracts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="max-w-[18rem]"><JobRef job={c.job} href={`/jobs/${c.job.id}?tab=field&sub=labor`} /></TableCell>
                        <TableCell className="text-right tabular-nums">{usd(c.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(c.paid)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Spend by job</CardTitle></CardHeader>
            <CardContent className="p-0">
              {data.spendByJob.length === 0 ? (
                <EmptyState title="No expenses linked yet" description="Expenses attach when their payee matches this vendor's name." className="py-8" />
              ) : (
                <Table>
                  <TableBody>
                    {data.spendByJob.map((r) => (
                      <TableRow key={r.job.id}>
                        <TableCell className="max-w-[18rem]"><JobRef job={r.job} href={`/jobs/${r.job.id}?tab=money&sub=expenses`} /></TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{r.count} expense{r.count === 1 ? "" : "s"}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(r.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {data.recentExpenses.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Recent expenses</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableBody>
                    {data.recentExpenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{format(new Date(e.incurredDate), "MMM d, yyyy")}</TableCell>
                        <TableCell className="max-w-[16rem] whitespace-normal">
                          <div className="break-words text-sm">{e.vendor}</div>
                          <JobRef job={e.job} inline customer={false} trade={false} className="text-xs" />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {usd(e.amount)}
                          {e.status !== "APPROVED" && <div className="text-xs text-muted-foreground">{e.status.toLowerCase()}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <VendorFormDialog
        open={editing}
        onOpenChange={setEditing}
        vendorId={vendor.id}
        initial={{
          name: vendor.name,
          kind: vendor.kind,
          trade: vendor.trade ?? "",
          contactName: vendor.contactName ?? "",
          phone: vendor.phone ?? "",
          email: vendor.email ?? "",
          address: vendor.address ?? "",
          notes: vendor.notes ?? "",
        }}
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
