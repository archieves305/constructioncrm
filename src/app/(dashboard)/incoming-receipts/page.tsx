"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Trash2, CheckCircle, XCircle, RotateCcw } from "lucide-react";

type Receipt = {
  id: string;
  vendor: string;
  poText: string | null;
  purchaseDate: string;
  amount: string;
  reference: string | null;
  notes: string | null;
  status: "UNMATCHED" | "MATCHED" | "DISMISSED";
  matchedJobId: string | null;
  matchedJob: {
    id: string;
    jobNumber: string;
    lead: { fullName: string; propertyAddress1: string };
  } | null;
  uploadedBy: { firstName: string; lastName: string };
};

type JobOption = {
  id: string;
  jobNumber: string;
  title: string;
  lead: { fullName: string; propertyAddress1: string };
};

export default function IncomingReceiptsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"UNMATCHED" | "MATCHED" | "DISMISSED">("UNMATCHED");

  const { data, isLoading } = useQuery<{
    receipts: Receipt[];
    counts: Record<string, number>;
  }>({
    queryKey: ["incoming-receipts", tab],
    queryFn: () =>
      fetch(`/api/incoming-receipts?status=${tab}`).then((r) => r.json()),
  });

  const { data: jobs = [] } = useQuery<{ data: JobOption[] }>({
    queryKey: ["jobs-for-matching"],
    queryFn: () => fetch(`/api/jobs?pageSize=500`).then((r) => r.json()),
    select: (body) => body as unknown as { data: JobOption[] },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/incoming-receipts/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json() as Promise<{
        created: number;
        autoMatched: number;
        unmatched: number;
        skipped: number;
        errors: string[];
      }>;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["incoming-receipts"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(
        `Imported ${r.created}: ${r.autoMatched} auto-matched, ${r.unmatched} unmatched${r.skipped ? `, ${r.skipped} skipped` : ""}`,
      );
      if (r.errors.length > 0) {
        toast.error(r.errors.slice(0, 3).join(" | "));
      }
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const act = useMutation({
    mutationFn: ({
      id,
      action,
      jobId,
    }: {
      id: string;
      action: "match" | "unmatch" | "dismiss" | "restore" | "delete";
      jobId?: string;
    }) =>
      fetch(`/api/incoming-receipts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, jobId }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incoming-receipts"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const jobsArr = (jobs as unknown as { data: JobOption[] })?.data || [];
  const receipts = data?.receipts || [];
  const counts = data?.counts || {};

  return (
    <div>
      <PageHeader
        title="Incoming Receipts"
        description="Weekly CSV import from vendor accounts with automatic address matching"
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
            >
              <Upload className="mr-2 h-4 w-4" />
              {upload.isPending ? "Uploading…" : "Upload CSV"}
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="pt-4 text-sm">
          <p className="font-medium">CSV format (case-insensitive headers)</p>
          <p className="mt-1 text-muted-foreground">
            Required columns: <code>vendor</code>, <code>date</code>,{" "}
            <code>po</code>, <code>amount</code>. Optional:{" "}
            <code>reference</code>, <code>notes</code>.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The <code>po</code> column should contain the property street
            address (full or partial). Rows with a single active job matching
            the address are linked automatically as MATERIAL expenses (non-billable).
          </p>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="UNMATCHED">
            Unmatched ({counts.UNMATCHED ?? 0})
          </TabsTrigger>
          <TabsTrigger value="MATCHED">
            Matched ({counts.MATCHED ?? 0})
          </TabsTrigger>
          <TabsTrigger value="DISMISSED">
            Dismissed ({counts.DISMISSED ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>PO / Address</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Ref</TableHead>
                    {tab !== "UNMATCHED" && <TableHead>Job</TableHead>}
                    <TableHead className="w-[280px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : receipts.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-muted-foreground"
                      >
                        None.
                      </TableCell>
                    </TableRow>
                  ) : (
                    receipts.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Badge variant="outline">{r.vendor}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(r.purchaseDate), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate text-sm">
                          {r.poText || "—"}
                        </TableCell>
                        <TableCell className="font-medium">
                          ${Number(r.amount).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.reference || "—"}
                        </TableCell>
                        {tab !== "UNMATCHED" && (
                          <TableCell className="text-sm">
                            {r.matchedJob ? (
                              <Link
                                href={`/jobs/${r.matchedJob.id}`}
                                className="font-mono text-blue-600 hover:underline"
                              >
                                {r.matchedJob.jobNumber}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          {r.status === "UNMATCHED" && (
                            <div className="flex items-center gap-2">
                              <Select
                                onValueChange={(v: string | null) =>
                                  v &&
                                  act.mutate({
                                    id: r.id,
                                    action: "match",
                                    jobId: v,
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 w-[180px] text-xs">
                                  <SelectValue placeholder="Match to job…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {jobsArr.map((j) => (
                                    <SelectItem key={j.id} value={j.id}>
                                      {j.lead.propertyAddress1}{" "}
                                      <span className="text-muted-foreground">
                                        · {j.lead.fullName} · {j.jobNumber}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-amber-700"
                                onClick={() =>
                                  act.mutate({ id: r.id, action: "dismiss" })
                                }
                                title="Dismiss"
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => {
                                  if (confirm("Delete this receipt permanently?"))
                                    act.mutate({ id: r.id, action: "delete" });
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                          {r.status === "MATCHED" && (
                            <div className="flex items-center gap-2">
                              <Badge variant="default" className="text-xs">
                                <CheckCircle className="mr-1 h-3 w-3" />
                                Matched
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  act.mutate({ id: r.id, action: "unmatch" })
                                }
                              >
                                Unmatch
                              </Button>
                            </div>
                          )}
                          {r.status === "DISMISSED" && (
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  act.mutate({ id: r.id, action: "restore" })
                                }
                              >
                                <RotateCcw className="mr-1 h-3 w-3" />
                                Restore
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => {
                                  if (confirm("Delete permanently?"))
                                    act.mutate({ id: r.id, action: "delete" });
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
