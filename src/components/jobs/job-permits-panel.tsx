"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { fetchJson } from "@/lib/fetch-json";

export type JobPermit = {
  id: string;
  permitType: string | null;
  municipality: string;
  status: string;
  permitNumber: string | null;
  submittedDate: string | null;
  approvedDate: string | null;
  expirationDate?: string | null;
};

const emptyPermitForm = {
  municipality: "",
  permitType: "",
  permitNumber: "",
  submittedDate: new Date().toISOString().slice(0, 10),
  expectedApprovalDate: "",
  expirationDate: "",
  permitFee: "",
  inspectorName: "",
  assignedUserId: "",
  notes: "",
};

/** Add a permit to the job and list the ones it has. Moved out of the job page verbatim. */
export function JobPermitsPanel({ jobId, permits }: { jobId: string; permits: JobPermit[] }) {
  const qc = useQueryClient();
  const [permitForm, setPermitForm] = useState(emptyPermitForm);
  const setPermitField = (k: keyof typeof emptyPermitForm, v: string) => setPermitForm((f) => ({ ...f, [k]: v }));

  const { data: jobUsers = [] } = useQuery<{ id: string; firstName: string; lastName: string }[]>({
    queryKey: ["assignable-users"],
    queryFn: () => fetchJson("/api/users/assignable"),
  });

  const addPermit = useMutation({
    mutationFn: (data: typeof emptyPermitForm) =>
      fetchJson(`/api/jobs/${jobId}/permits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          assignedUserId: data.assignedUserId || null,
          permitFee: data.permitFee || null,
          expectedApprovalDate: data.expectedApprovalDate || null,
          expirationDate: data.expirationDate || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      setPermitForm(emptyPermitForm);
      toast.success("Permit added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Add a permit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[11px]">Jurisdiction *</Label>
              <Input value={permitForm.municipality} onChange={(e) => setPermitField("municipality", e.target.value)} placeholder="City of Boca Raton" />
            </div>
            <div>
              <Label className="text-[11px]">Permit type</Label>
              <Input value={permitForm.permitType} onChange={(e) => setPermitField("permitType", e.target.value)} placeholder="Re-roof, Electrical, …" />
            </div>
            <div>
              <Label className="text-[11px]">Permit #</Label>
              <Input value={permitForm.permitNumber} onChange={(e) => setPermitField("permitNumber", e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px]">Coordinator</Label>
              <Select value={permitForm.assignedUserId || "unassigned"} onValueChange={(v: string | null) => v && setPermitField("assignedUserId", v === "unassigned" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {jobUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">Submitted</Label>
              <Input type="date" value={permitForm.submittedDate} onChange={(e) => setPermitField("submittedDate", e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px]">Expected approval</Label>
              <Input type="date" value={permitForm.expectedApprovalDate} onChange={(e) => setPermitField("expectedApprovalDate", e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px]">Expires</Label>
              <Input type="date" value={permitForm.expirationDate} onChange={(e) => setPermitField("expirationDate", e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px]">Permit fee</Label>
              <Input value={permitForm.permitFee} inputMode="decimal" placeholder="0.00" onChange={(e) => setPermitField("permitFee", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[11px]">Inspector</Label>
              <Input value={permitForm.inspectorName} onChange={(e) => setPermitField("inspectorName", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[11px]">Notes</Label>
              <Textarea rows={2} value={permitForm.notes} onChange={(e) => setPermitField("notes", e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={!permitForm.municipality || addPermit.isPending} onClick={() => addPermit.mutate(permitForm)}>
              Add permit
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {permits.map((p) => (
          <Card key={p.id}>
            <CardContent className="flex items-center justify-between py-3 px-4">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-sm font-medium">{p.permitType || "General"}</span>
                  <span className="text-xs text-muted-foreground ml-2">({p.municipality})</span>
                  {p.permitNumber && <span className="text-xs ml-2">#{p.permitNumber}</span>}
                  {p.expirationDate && <span className="text-[10px] text-muted-foreground ml-2">exp {format(new Date(p.expirationDate), "MMM d, yyyy")}</span>}
                </div>
              </div>
              <Badge variant="outline" className="text-xs">{p.status}</Badge>
            </CardContent>
          </Card>
        ))}
        {permits.length === 0 && <EmptyState icon={Shield} title="No permits on this job" description="Add one above once it is submitted; the workflow's permit branch reads from here." />}
      </div>
    </div>
  );
}
