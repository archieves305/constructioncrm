"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { Search, AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCsv, downloadCsv } from "@/lib/csv";

const stageColors: Record<string, string> = {
  "Won": "bg-green-100 text-green-800",
  "Deposit Needed": "bg-amber-100 text-amber-800",
  "Financing Cleared": "bg-blue-100 text-blue-800",
  "Permit Submitted": "bg-purple-100 text-purple-800",
  "Permit Approved": "bg-teal-100 text-teal-800",
  "Scheduled": "bg-indigo-100 text-indigo-800",
  "In Progress": "bg-cyan-100 text-cyan-800",
  "Final Payment Due": "bg-orange-100 text-orange-800",
  "Closed": "bg-gray-100 text-gray-800",
};

type JobRow = {
  id: string;
  jobNumber: string;
  title: string;
  serviceType: string;
  contractAmount: string;
  depositReceived: string;
  depositRequired: string;
  balanceDue: string;
  nextAction: string | null;
  scheduledDate: string | null;
  currentStage: { name: string };
  lead: { fullName: string; propertyAddress1: string; city: string };
  salesRep: { firstName: string; lastName: string } | null;
  permits: { status: string }[];
  createdAt: string;
};

export default function JobsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [stageId, setStageId] = useState("");

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (stageId) params.set("stageId", stageId);

  const { data, isLoading } = useQuery({
    queryKey: ["jobs", search, stageId],
    queryFn: () => fetch(`/api/jobs?${params.toString()}`).then((r) => r.json()),
  });

  const { data: stages } = useQuery({
    queryKey: ["jobStages"],
    queryFn: () => fetch("/api/jobs/stages").then((r) => r.json()),
  });

  return (
    <div>
      <PageHeader
        title="Jobs"
        description={`${data?.total || 0} active jobs`}
        actions={
          <Button
            variant="outline"
            onClick={async () => {
              const exportParams = new URLSearchParams(params);
              exportParams.set("pageSize", "5000");
              const res = await fetch(`/api/jobs?${exportParams.toString()}`);
              const body = await res.json();
              const rows = (body.data || []).map((j: JobRow) => ({
                jobNumber: j.jobNumber,
                title: j.title,
                customer: j.lead.fullName,
                serviceType: j.serviceType,
                stage: j.currentStage.name,
                contractAmount: j.contractAmount,
                depositReceived: j.depositReceived,
                balanceDue: j.balanceDue,
                salesRep: j.salesRep
                  ? `${j.salesRep.firstName} ${j.salesRep.lastName}`
                  : "",
                scheduledDate: j.scheduledDate ?? "",
                createdAt: j.createdAt,
              }));
              const csv = toCsv(rows, [
                { key: "jobNumber", header: "Job #" },
                { key: "title", header: "Title" },
                { key: "customer", header: "Customer" },
                { key: "serviceType", header: "Service" },
                { key: "stage", header: "Stage" },
                { key: "contractAmount", header: "Contract" },
                { key: "depositReceived", header: "Deposit" },
                { key: "balanceDue", header: "Balance" },
                { key: "salesRep", header: "Sales Rep" },
                { key: "scheduledDate", header: "Scheduled" },
                { key: "createdAt", header: "Created" },
              ]);
              downloadCsv(`jobs-${new Date().toISOString().slice(0, 10)}.csv`, csv);
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search jobs..."
            className="pl-9"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); }}
          />
        </div>
        <Select
          value={stageId}
          onValueChange={(v: string | null) => setStageId(!v || v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Stages">
              {(v: string) =>
                !v
                  ? "All Stages"
                  : stages?.find((s: { id: string; name: string }) => s.id === v)?.name ??
                    "All Stages"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {stages?.map((s: { id: string; name: string }) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Contract</TableHead>
              <TableHead>Deposit</TableHead>
              <TableHead>Permit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Next Action</TableHead>
              <TableHead>Rep</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
            ) : !data?.data?.length ? (
              <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">No jobs found</TableCell></TableRow>
            ) : (
              data.data.map((job: JobRow) => {
                const depositPct = Number(job.depositRequired) > 0
                  ? Math.round((Number(job.depositReceived) / Number(job.depositRequired)) * 100)
                  : 0;
                const hasPermit = job.permits?.length > 0;
                const permitStatus = hasPermit ? job.permits[0].status : null;

                return (
                  <TableRow
                    key={job.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => router.push(`/jobs/${job.id}`)}
                  >
                    <TableCell className="font-mono text-sm font-medium">{job.jobNumber}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{job.lead.fullName}</div>
                      <div className="text-xs text-muted-foreground">{job.lead.propertyAddress1}, {job.lead.city}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{job.serviceType}</Badge></TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`border-0 text-xs font-medium ${stageColors[job.currentStage.name] || "bg-gray-100"}`}>
                        {job.currentStage.name}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">${Number(job.contractAmount).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${depositPct >= 100 ? "bg-green-500" : "bg-amber-500"}`} style={{ width: `${Math.min(depositPct, 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{depositPct}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {hasPermit ? (
                        <Badge variant="outline" className="text-[10px]">{permitStatus}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={Number(job.balanceDue) > 0 ? "font-medium" : "text-green-600"}>
                        ${Number(job.balanceDue).toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      {job.nextAction ? (
                        <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">{job.nextAction}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {job.salesRep ? `${job.salesRep.firstName} ${job.salesRep.lastName[0]}.` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
