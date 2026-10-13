"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ClipboardCheck, Download } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv, toCsv } from "@/lib/csv";
import { QUAL_STATUS_LABEL } from "@/lib/partners/qualification-state";
import { QualStatusBadge } from "@/components/partners/qualification-panel";
import { PartnerStageBadge } from "@/components/partners/stage-badges";
import { personName, useQualificationsAcross } from "@/components/partners/use-partners";

type Queue = "all" | "pending" | "info" | "expiring" | "expired";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", d: undefined, day: "numeric", year: "numeric", timeZone: "UTC" } as Intl.DateTimeFormatOptions) : "—");

export default function QualificationsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Qualifications />
    </Suspense>
  );
}

function Qualifications() {
  const url = useSearchParamState();
  const queue = (["pending", "info", "expiring", "expired"].includes(url.get("queue") ?? "") ? url.get("queue") : "all") as Queue;
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (queue === "pending") p.set("status", "SUBMITTED");
    if (queue === "info") p.set("status", "INFO_REQUESTED");
    if (queue === "expiring") p.set("derived", "EXPIRING");
    if (queue === "expired") p.set("derived", "EXPIRED");
    return p;
  }, [queue]);
  const list = useQualificationsAcross(params);
  const rows = list.data?.rows ?? [];

  const exportCsv = () =>
    downloadCsv(
      `qualifications-${format(new Date(), "yyyy-MM-dd")}.csv`,
      toCsv(
        rows.map((q) => ({ account: q.organization.name, platform: q.platform ?? "", status: QUAL_STATUS_LABEL[q.derivedStatus], submitted: q.submittedAt?.slice(0, 10) ?? "", approved: q.approvedAt?.slice(0, 10) ?? "", expires: q.expiresAt?.slice(0, 10) ?? "", coverage: `${q.coverage.satisfied}/${q.coverage.required}`, owner: personName(q.owner) ?? personName(q.organization.owner) ?? "" })),
        [
          { key: "account", header: "Account" },
          { key: "platform", header: "Platform" },
          { key: "status", header: "Status" },
          { key: "submitted", header: "Submitted" },
          { key: "approved", header: "Approved" },
          { key: "expires", header: "Expires" },
          { key: "coverage", header: "Required documents" },
          { key: "owner", header: "Owner" },
        ],
      ),
    );

  return (
    <div>
      <PageHeader
        title="Qualifications"
        breadcrumb={[{ label: "Business Development" }, { label: "Qualifications" }]}
        description="Every prequalification across accounts: where it stands, what the GC still wants, when it expires."
        actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}><Download className="mr-1.5 size-4" /> CSV</Button>}
      />
      <div className="mb-3">
        <SegmentedControl<Queue>
          ariaLabel="Queue"
          size="sm"
          value={queue}
          onValueChange={(v) => url.set("queue", v === "all" ? null : v)}
          options={[
            { value: "all", label: "All" },
            { value: "pending", label: "Submitted, waiting" },
            { value: "info", label: "Info requested" },
            { value: "expiring", label: "Expiring 90 d" },
            { value: "expired", label: "Expired" },
          ]}
        />
      </div>
      {list.isLoading ? (
        <ListSkeleton rows={6} />
      ) : list.isError ? (
        <EmptyState icon={ClipboardCheck} title="The qualifications could not be loaded" description={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={queue === "all" ? "No qualifications yet" : "Nothing in this queue"} description={queue === "all" ? "Start one from an account's Qualification tab when a GC asks KNU to prequalify." : "Try another queue."} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Documents</TableHead>
                  <TableHead className="hidden sm:table-cell">Submitted</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="hidden lg:table-cell">Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell>
                      <Link href={`/partners/${q.organization.id}?tab=qualification`} className="font-medium text-gray-900 hover:underline">{q.organization.name}</Link>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <PartnerStageBadge stage={q.organization.stage} />
                        {q.platform && <span>{q.platform}</span>}
                      </div>
                    </TableCell>
                    <TableCell><QualStatusBadge status={q.derivedStatus} /></TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {q.coverage.satisfied} of {q.coverage.required} required
                      {q.coverage.missing > 0 && <span className="ml-1 text-xs text-tone-danger-fg">· {q.coverage.missing} missing</span>}
                    </TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{day(q.submittedAt)}</TableCell>
                    <TableCell className="text-sm">{day(q.expiresAt)}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{personName(q.owner) ?? personName(q.organization.owner) ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
