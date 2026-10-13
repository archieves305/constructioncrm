"use client";

import { useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Gavel, HardHat, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BidStatusBadge } from "./bid-panel";
import { useBids, type OrgDetail } from "./use-partners";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));

/** Every bid package from this account, open first. */
export function OrgBidsTab({ organizationId, canManage, onLog }: { organizationId: string; canManage: boolean; onLog: () => void }) {
  const params = useMemo(() => new URLSearchParams({ organizationId, closed: "1", pageSize: "500" }), [organizationId]);
  const list = useBids(params);
  if (list.isLoading) return <ListSkeleton rows={4} />;
  if (list.isError) return <EmptyState icon={Gavel} title="The bids could not be loaded" description={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>Try again</Button>} />;
  const rows = [...(list.data?.rows ?? [])].sort((a, b) => Number(a.status === "CLOSED") - Number(b.status === "CLOSED"));
  const decided = rows.filter((b) => b.outcome === "AWARDED" || b.outcome === "LOST");
  const won = decided.filter((b) => b.outcome === "AWARDED").length;
  if (rows.length === 0) return <EmptyState icon={Gavel} title="No bids from this account yet" description="Log one when they invite KNU to price a package." action={canManage ? <Button variant="brand" onClick={onLog}><Plus className="mr-1.5 size-4" />Log a bid</Button> : undefined} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} bid{rows.length === 1 ? "" : "s"} · {rows.filter((b) => b.status !== "CLOSED").length} open
          {decided.length > 0 && <> · won {won} of {decided.length} decided</>}
        </p>
        {canManage && <Button size="sm" variant="outline" onClick={onLog}><Plus className="mr-1 size-4" />Log a bid</Button>}
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Due</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link href={`/leads/${b.leadId}?tab=bid`} className="font-medium text-gray-900 hover:underline">{b.projectName}</Link>
                    <div className="text-xs text-muted-foreground"><span className="font-mono">{b.number}</span>{b.lead.trades.length > 0 && <> · {b.lead.trades.map((t) => t.name).join(", ")}</>}</div>
                  </TableCell>
                  <TableCell><BidStatusBadge status={b.status} label={b.statusLabel} outcome={b.outcome} /></TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{b.bidDueAt ? format(new Date(b.bidDueAt), "MMM d, yyyy") : "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{b.outcome === "AWARDED" ? usd(b.awardedAmount) : b.latestAmount != null ? usd(b.latestAmount) : <span className="text-muted-foreground">{usd(b.lead.estimatedJobValue)}</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/** Jobs that came from this account's leads and awards. */
export function OrgProjectsTab({ projects }: { projects: OrgDetail["projects"] }) {
  if (projects.length === 0) return <EmptyState icon={HardHat} title="No jobs with this account yet" description="An awarded bid becomes a job here, with progress billing and retainage." />;
  const total = projects.reduce((s, j) => s + j.contractAmount, 0);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{projects.length} job{projects.length === 1 ? "" : "s"} · {usd(total)} contracted</p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead className="hidden sm:table-cell">Stage</TableHead>
                <TableHead className="text-right">Contract</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((j) => (
                <TableRow key={j.id}>
                  <TableCell>
                    <Link href={`/jobs/${j.id}`} className="font-medium text-gray-900 hover:underline">{j.title}</Link>
                    <div className="text-xs text-muted-foreground"><span className="font-mono">{j.jobNumber}</span> · {j.billingMethod === "PROGRESS" ? "progress billing" : "lump sum"} · since {format(new Date(j.createdAt), "MMM yyyy")}</div>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{j.currentStage?.name ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{usd(j.contractAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Revenue, margin and days to pay per account arrive with the scorecard (Stage 4).</p>
    </div>
  );
}
