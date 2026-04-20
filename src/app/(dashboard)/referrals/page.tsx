"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { format } from "date-fns";
import { DollarSign } from "lucide-react";

const STATUSES = ["NEW", "CONTACTED", "CONVERTED", "DECLINED"] as const;

type Referral = {
  id: string;
  referredName: string;
  referredPhone: string | null;
  referredEmail: string | null;
  status: (typeof STATUSES)[number];
  commissionAmount: string | null;
  commissionPaidAt: string | null;
  createdAt: string;
  job: { id: string; jobNumber: string };
  referredBy: { id: string; fullName: string };
};

export default function ReferralsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Referral | null>(null);
  const [commission, setCommission] = useState("");
  const [markPaid, setMarkPaid] = useState(false);

  const { data: referrals = [], isLoading } = useQuery<Referral[]>({
    queryKey: ["referrals"],
    queryFn: () => fetch("/api/referrals").then((r) => r.json()),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetch(`/api/referrals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["referrals"] });
      toast.success("Status updated");
    },
  });

  const saveCommission = useMutation({
    mutationFn: async () => {
      if (!editing) return null;
      const payload: Record<string, unknown> = {
        commissionAmount: commission ? Number(commission) : null,
      };
      if (markPaid) payload.commissionPaidAt = new Date().toISOString();
      const res = await fetch(`/api/referrals/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["referrals"] });
      setEditing(null);
      setCommission("");
      setMarkPaid(false);
      toast.success("Commission saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openEdit(r: Referral) {
    setEditing(r);
    setCommission(r.commissionAmount ?? "");
    setMarkPaid(false);
  }

  const totalUnpaid = referrals
    .filter((r) => r.commissionAmount && !r.commissionPaidAt)
    .reduce((sum, r) => sum + Number(r.commissionAmount), 0);
  const totalPaid = referrals
    .filter((r) => r.commissionPaidAt)
    .reduce((sum, r) => sum + Number(r.commissionAmount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Referrals"
        description={`${referrals.length} referrals · $${totalUnpaid.toLocaleString()} commission owed · $${totalPaid.toLocaleString()} paid`}
      />

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Commission for {editing?.referredName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Commission amount ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
                placeholder="e.g. 250"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={markPaid}
                onChange={(e) => setMarkPaid(e.target.checked)}
              />
              Mark as paid now
            </label>
            {editing?.commissionPaidAt && (
              <p className="text-xs text-muted-foreground">
                Previously paid {format(new Date(editing.commissionPaidAt), "MMM d, yyyy")}
              </p>
            )}
            <Button
              className="w-full"
              disabled={saveCommission.isPending}
              onClick={() => saveCommission.mutate()}
            >
              {saveCommission.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referred by</TableHead>
                <TableHead>Referred name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Job</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : referrals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No referrals yet.
                  </TableCell>
                </TableRow>
              ) : (
                referrals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell
                      className="cursor-pointer hover:underline"
                      onClick={() => router.push(`/leads/${r.referredBy.id}`)}
                    >
                      {r.referredBy.fullName}
                    </TableCell>
                    <TableCell className="font-medium">{r.referredName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.referredPhone || r.referredEmail || "—"}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={r.status}
                        onValueChange={(v: string | null) =>
                          v && updateStatus.mutate({ id: r.id, status: v })
                        }
                      >
                        <SelectTrigger className="h-7 w-[140px] text-xs">
                          <SelectValue>
                            {(v: string) => v?.replace(/_/g, " ") || r.status}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {r.commissionAmount ? (
                        <span className="font-medium">
                          ${Number(r.commissionAmount).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.commissionPaidAt ? (
                        <Badge variant="default" className="text-xs">
                          {format(new Date(r.commissionPaidAt), "MMM d")}
                        </Badge>
                      ) : r.commissionAmount ? (
                        <Badge variant="secondary" className="text-xs">Owed</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="cursor-pointer font-mono text-xs hover:underline"
                      onClick={() => router.push(`/jobs/${r.job.id}`)}
                    >
                      {r.job.jobNumber}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(r)}
                      >
                        <DollarSign className="mr-1 h-3 w-3" />
                        {r.commissionAmount ? "Edit" : "Set"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
