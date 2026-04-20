"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { Plus, Search, AlertTriangle, Download } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { format } from "date-fns";

export default function LeadsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stageId, setStageId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [page, setPage] = useState(1);

  const changeStage = useMutation({
    mutationFn: ({ leadId, stageId }: { leadId: string; stageId: string }) =>
      fetch(`/api/leads/${leadId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to update stage");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Stage updated");
    },
    onError: () => toast.error("Failed to update stage"),
  });

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (stageId) params.set("stageId", stageId);
  if (sourceId) params.set("sourceId", sourceId);
  if (includeClosed) params.set("includeClosed", "true");
  params.set("page", String(page));

  const { data, isLoading } = useQuery({
    queryKey: ["leads", search, stageId, sourceId, includeClosed, page],
    queryFn: () =>
      fetch(`/api/leads?${params.toString()}`).then((r) => r.json()),
  });

  const { data: stages } = useQuery({
    queryKey: ["stages"],
    queryFn: () => fetch("/api/admin/stages").then((r) => r.json()),
  });

  const { data: sources } = useQuery({
    queryKey: ["sources"],
    queryFn: () => fetch("/api/admin/sources").then((r) => r.json()),
  });

  return (
    <div>
      <PageHeader
        title="Leads"
        description={`${data?.total || 0} total leads`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={async () => {
                const exportParams = new URLSearchParams(params);
                exportParams.set("pageSize", "5000");
                exportParams.delete("page");
                const res = await fetch(`/api/leads?${exportParams.toString()}`);
                const body = await res.json();
                const rows = (body.data || []).map((l: {
                  fullName: string;
                  primaryPhone: string;
                  email: string | null;
                  propertyAddress1: string;
                  city: string;
                  zipCode: string;
                  currentStage: { name: string };
                  source: { name: string } | null;
                  assignedUser: { firstName: string; lastName: string } | null;
                  createdAt: string;
                }) => ({
                  fullName: l.fullName,
                  phone: l.primaryPhone,
                  email: l.email ?? "",
                  address: `${l.propertyAddress1}, ${l.city} ${l.zipCode}`,
                  stage: l.currentStage.name,
                  source: l.source?.name ?? "",
                  assignedTo: l.assignedUser
                    ? `${l.assignedUser.firstName} ${l.assignedUser.lastName}`
                    : "",
                  createdAt: l.createdAt,
                }));
                const csv = toCsv(rows, [
                  { key: "fullName", header: "Name" },
                  { key: "phone", header: "Phone" },
                  { key: "email", header: "Email" },
                  { key: "address", header: "Address" },
                  { key: "stage", header: "Stage" },
                  { key: "source", header: "Source" },
                  { key: "assignedTo", header: "Assigned To" },
                  { key: "createdAt", header: "Created" },
                ]);
                downloadCsv(`leads-${new Date().toISOString().slice(0, 10)}.csv`, csv);
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button onClick={() => router.push("/leads/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Lead
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search name, phone, address..."
            className="pl-9"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={stageId}
          onValueChange={(v: string | null) => {
            setStageId(!v || v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
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
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sourceId}
          onValueChange={(v: string | null) => {
            setSourceId(!v || v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Sources">
              {(v: string) =>
                !v
                  ? "All Sources"
                  : sources?.find((s: { id: string; name: string }) => s.id === v)?.name ??
                    "All Sources"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {sources?.map((s: { id: string; name: string }) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => {
              setIncludeClosed(e.target.checked);
              setPage(1);
            }}
          />
          Show won/lost
        </label>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Services</TableHead>
              <TableHead>Created</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !data?.data?.length ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  No leads found
                </TableCell>
              </TableRow>
            ) : (
              data.data.map(
                (lead: {
                  id: string;
                  fullName: string;
                  primaryPhone: string;
                  propertyAddress1: string;
                  city: string;
                  state: string;
                  currentStageId: string;
                  currentStage: { name: string };
                  source: { name: string } | null;
                  assignedUser: { firstName: string; lastName: string } | null;
                  services: { serviceCategory: { name: string } }[];
                  createdAt: string;
                  isDuplicateFlag: boolean;
                  nextFollowUpAt: string | null;
                }) => {
                  const isOverdue =
                    lead.nextFollowUpAt &&
                    new Date(lead.nextFollowUpAt) < new Date();

                  return (
                    <TableRow
                      key={lead.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/leads/${lead.id}`)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {lead.fullName}
                          {lead.isDuplicateFlag && (
                            <Badge variant="destructive" className="text-[10px] px-1 py-0">
                              DUP
                            </Badge>
                          )}
                          {isOverdue && (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{lead.primaryPhone}</TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {lead.propertyAddress1}, {lead.city}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={lead.currentStageId}
                          onValueChange={(v: string | null) => {
                            if (v && v !== lead.currentStageId) {
                              changeStage.mutate({
                                leadId: lead.id,
                                stageId: v,
                              });
                            }
                          }}
                        >
                          <SelectTrigger className="h-7 w-[160px] text-xs">
                            <SelectValue>
                              {(v: string) =>
                                stages?.find(
                                  (s: { id: string; name: string }) => s.id === v,
                                )?.name ?? lead.currentStage.name
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {stages?.map((s: { id: string; name: string }) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{lead.source?.name || "—"}</TableCell>
                      <TableCell>
                        {lead.assignedUser
                          ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`
                          : "Unassigned"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {lead.services.slice(0, 2).map((s, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">
                              {s.serviceCategory.name}
                            </Badge>
                          ))}
                          {lead.services.length > 2 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{lead.services.length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(lead.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/leads/${lead.id}`}
                          className="text-blue-600 hover:underline text-sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                }
              )
            )}
          </TableBody>
        </Table>
      </div>

      {data?.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
