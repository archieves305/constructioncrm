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

export default function CollectionsPage() {
  const router = useRouter();

  const { data: jobsData, isLoading } = useQuery({
    queryKey: ["jobs", "collections"],
    queryFn: () => fetch("/api/jobs?pageSize=500").then((r) => r.json()),
  });

  const jobs: CollectionJob[] = jobsData?.data || [];

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

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <KpiCard title="Total Contracted" value={`$${totalContracted.toLocaleString()}`} icon={DollarSign} />
        <KpiCard title="Total Collected" value={`$${totalCollected.toLocaleString()}`} icon={CheckCircle} />
        <KpiCard title="Outstanding" value={`$${totalOutstanding.toLocaleString()}`} icon={Clock} />
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
