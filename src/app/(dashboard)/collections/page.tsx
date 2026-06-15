"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { DollarSign, AlertTriangle, CheckCircle, Clock } from "lucide-react";

type CollectionJob = {
  id: string;
  jobNumber: string;
  title: string;
  contractAmount: string;
  depositRequired: string;
  depositReceived: string;
  balanceDue: string;
  finalPaymentReceived: boolean;
  currentStage: { name: string };
  lead: { fullName: string; primaryPhone: string; city: string };
  salesRep: { firstName: string; lastName: string } | null;
};

type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus";

type FinancialsResponse = {
  aging: {
    rows: {
      invoiceId: string;
      invoiceNumber: string;
      jobId: string;
      jobNumber: string;
      customer: string;
      remaining: number;
      dueDate: string | null;
      ageDays: number;
      bucket: AgingBucket;
    }[];
    buckets: Record<AgingBucket, number>;
    totalOutstanding: number;
    totalOverdue: number;
  };
  summary: {
    totalContracted: number;
    totalCollected: number;
    totalOutstandingAR: number;
    jobs: {
      jobId: string;
      jobNumber: string;
      title: string;
      jobType: string;
      revenue: number;
      cost: number;
      profit: number;
      margin: number;
    }[];
  };
};

const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d1_30: "1–30",
  d31_60: "31–60",
  d61_90: "61–90",
  d90plus: "90+",
};

function money(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

export default function CollectionsPage() {
  const router = useRouter();

  const { data: jobsData, isLoading } = useQuery({
    queryKey: ["jobs", "collections"],
    queryFn: () => fetch("/api/jobs?pageSize=500").then((r) => r.json()),
  });

  const { data: financials } = useQuery<FinancialsResponse>({
    queryKey: ["reports", "financials"],
    queryFn: () => fetch("/api/reports/financials").then((r) => r.json()),
  });

  const jobs: CollectionJob[] = jobsData?.data || [];
  const aging = financials?.aging;
  const profitability = financials?.summary.jobs ?? [];
  const overdueRows = (aging?.rows ?? []).filter((r) => r.ageDays > 0);

  const depositsMissing = jobs.filter(
    (j) => Number(j.depositReceived) < Number(j.depositRequired)
  );
  const balancesDue = jobs.filter(
    (j) => Number(j.balanceDue) > 0 && !j.finalPaymentReceived
  );
  const finalPaymentDue = jobs.filter(
    (j) => j.currentStage.name === "Final Payment Due"
  );
  const paidInFull = jobs.filter((j) => j.finalPaymentReceived);

  const totalContracted = jobs.reduce((s, j) => s + Number(j.contractAmount), 0);
  const totalCollected = jobs.reduce((s, j) => s + (Number(j.contractAmount) - Number(j.balanceDue)), 0);
  const totalOutstanding = jobs.reduce((s, j) => s + Number(j.balanceDue), 0);

  return (
    <div>
      <PageHeader title="Collections" description="Track deposits, balances, and payments" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-6">
        <KpiCard title="Total Contracted" value={`$${totalContracted.toLocaleString()}`} icon={DollarSign} />
        <KpiCard title="Total Collected" value={`$${totalCollected.toLocaleString()}`} icon={CheckCircle} />
        <KpiCard title="Outstanding" value={`$${totalOutstanding.toLocaleString()}`} icon={Clock} />
        <KpiCard title="Overdue A/R" value={money(aging?.totalOverdue ?? 0)} icon={AlertTriangle} />
        <KpiCard title="Deposits Missing" value={depositsMissing.length} icon={AlertTriangle} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Deposits Missing</CardTitle></CardHeader>
          <CardContent>
            {depositsMissing.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">All deposits collected</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Required</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {depositsMissing.map((j) => (
                    <TableRow key={j.id} className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/jobs/${j.id}`)}>
                      <TableCell className="font-mono text-xs">{j.jobNumber}</TableCell>
                      <TableCell className="text-sm">{j.lead.fullName}</TableCell>
                      <TableCell className="text-right">${Number(j.depositRequired).toLocaleString()}</TableCell>
                      <TableCell className="text-right">${Number(j.depositReceived).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-red-600 font-medium">
                        ${(Number(j.depositRequired) - Number(j.depositReceived)).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Final Payments Due</CardTitle></CardHeader>
          <CardContent>
            {finalPaymentDue.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No final payments pending</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finalPaymentDue.map((j) => (
                    <TableRow key={j.id} className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/jobs/${j.id}`)}>
                      <TableCell className="font-mono text-xs">{j.jobNumber}</TableCell>
                      <TableCell className="text-sm">{j.lead.fullName}</TableCell>
                      <TableCell className="text-sm">{j.lead.primaryPhone}</TableCell>
                      <TableCell className="text-right text-red-600 font-medium">
                        ${Number(j.balanceDue).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">A/R Aging (unpaid invoices)</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(["current", "d1_30", "d31_60", "d61_90", "d90plus"] as AgingBucket[]).map((b) => (
                <div key={b} className="rounded border p-2 text-center">
                  <div className="text-[10px] uppercase text-muted-foreground">{BUCKET_LABELS[b]}</div>
                  <div className={`text-sm font-semibold ${b === "d90plus" && (aging?.buckets[b] ?? 0) > 0 ? "text-red-600" : ""}`}>
                    {money(aging?.buckets[b] ?? 0)}
                  </div>
                </div>
              ))}
            </div>
            {overdueRows.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No overdue invoices</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead className="text-right">Days past due</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdueRows.map((r) => (
                    <TableRow key={r.invoiceId} className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/jobs/${r.jobId}`)}>
                      <TableCell className="font-mono text-xs">{r.invoiceNumber}</TableCell>
                      <TableCell className="text-sm">{r.customer}</TableCell>
                      <TableCell className="font-mono text-xs">{r.jobNumber}</TableCell>
                      <TableCell className="text-right">{r.ageDays}</TableCell>
                      <TableCell className="text-right font-medium text-red-600">{money(r.remaining)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Job Profitability</CardTitle></CardHeader>
          <CardContent>
            {profitability.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No billable jobs yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profitability.map((j) => (
                    <TableRow key={j.jobId} className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/jobs/${j.jobId}`)}>
                      <TableCell className="font-mono text-xs">{j.jobNumber}</TableCell>
                      <TableCell className="text-sm">{j.title}</TableCell>
                      <TableCell className="text-right">{money(j.revenue)}</TableCell>
                      <TableCell className="text-right">{money(j.cost)}</TableCell>
                      <TableCell className={`text-right font-medium ${j.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>
                        {money(j.profit)}
                      </TableCell>
                      <TableCell className={`text-right ${j.margin < 0 ? "text-red-600" : ""}`}>
                        {(j.margin * 100).toFixed(0)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">All Balances Due</CardTitle></CardHeader>
          <CardContent>
            {balancesDue.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">All paid up</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Contract</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Rep</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balancesDue.map((j) => (
                    <TableRow key={j.id} className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/jobs/${j.id}`)}>
                      <TableCell className="font-mono text-xs">{j.jobNumber}</TableCell>
                      <TableCell className="text-sm">{j.lead.fullName}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{j.currentStage.name}</Badge></TableCell>
                      <TableCell className="text-right">${Number(j.contractAmount).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-red-600 font-medium">${Number(j.balanceDue).toLocaleString()}</TableCell>
                      <TableCell className="text-sm">{j.salesRep ? `${j.salesRep.firstName} ${j.salesRep.lastName[0]}.` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
