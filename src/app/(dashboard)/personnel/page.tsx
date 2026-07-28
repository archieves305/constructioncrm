"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Search } from "lucide-react";

const EMPLOYMENT_LABELS: Record<string, string> = {
  W2: "Employee (W-2)",
  CONTRACTOR_1099: "Contractor (1099)",
  SUB_CREW: "Sub-crew",
  TEMP: "Temp",
};

// Pay BASIS, separate from the W-2/1099 tax classification above.
const PAY_TYPE_LABELS: Record<string, string> = {
  CONTRACT: "Contract",
  HOURLY: "Hourly",
  PIECEWORK: "Piecework",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  INACTIVE: "Inactive",
  TERMINATED: "Terminated",
};

type PersonnelRow = {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  trade: string | null;
  title: string | null;
  hourlyRate?: string | null;
  employmentType: string;
  payType: string;
  workDescription: string | null;
  status: string;
  entityName?: string | null;
  crew: { id: string; name: string } | null;
  isActive: boolean;
  hasSsn?: boolean;
};

type CrewOption = { id: string; name: string };

const emptyForm = {
  firstName: "",
  lastName: "",
  phone: "",
  trade: "",
  employmentType: "W2",
  payType: "HOURLY",
  workDescription: "",
  crewId: "",
};

export default function PersonnelPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (activeOnly) params.set("activeOnly", "true");

  const { data: people = [], isLoading } = useQuery<PersonnelRow[]>({
    queryKey: ["personnel", q, activeOnly],
    queryFn: () => fetch(`/api/personnel?${params.toString()}`).then((r) => r.json()),
  });

  const { data: crews = [] } = useQuery<CrewOption[]>({
    queryKey: ["crews", "options"],
    queryFn: () => fetch("/api/crews?activeOnly=true").then((r) => r.json()),
  });

  const createPerson = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone || null,
          trade: form.trade || null,
          employmentType: form.employmentType,
          payType: form.payType,
          workDescription: form.workDescription || null,
          crewId: form.crewId || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personnel"] });
      setDialogOpen(false);
      setForm(emptyForm);
      toast.success("Person added");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="p-6">
      <PageHeader
        title="Personnel"
        description="Crew members and laborers — profiles, trades, and employment records"
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
          <Input
            placeholder="Search name or company…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          Active only
        </label>
        <div className="flex-1" />
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add person
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading…</div>
      ) : people.length === 0 ? (
        <div className="text-muted-foreground rounded-md border py-12 text-center">
          No personnel yet. Add crew members to start tracking daily labor.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trade</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Pay</TableHead>
                <TableHead>Crew / Company</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/personnel/${p.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {p.lastName}, {p.firstName}
                    </Link>
                    {p.title && (
                      <div className="text-muted-foreground text-xs">{p.title}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.trade || "—"}
                    {p.workDescription && (
                      <div className="text-muted-foreground max-w-[260px] truncate text-xs">
                        {p.workDescription}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {EMPLOYMENT_LABELS[p.employmentType] ?? p.employmentType}
                  </TableCell>
                  <TableCell>
                    {PAY_TYPE_LABELS[p.payType] ?? p.payType}
                  </TableCell>
                  <TableCell>{p.crew?.name || p.entityName || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={p.isActive ? "default" : "secondary"}>
                      {STATUS_LABELS[p.status] ?? p.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add person</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="p-first">First name</Label>
                <Input
                  id="p-first"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-last">Last name</Label>
                <Input
                  id="p-last"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="p-phone">Phone</Label>
              <Input
                id="p-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="p-trade">Trade</Label>
              <Input
                id="p-trade"
                placeholder="e.g. Drywall"
                value={form.trade}
                onChange={(e) => setForm({ ...form, trade: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Employment</Label>
                <Select
                  value={form.employmentType}
                  onValueChange={(v) => v && setForm({ ...form, employmentType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Pay type</Label>
                <Select
                  value={form.payType}
                  onValueChange={(v) => v && setForm({ ...form, payType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAY_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="p-work">Work description</Label>
              <Input
                id="p-work"
                placeholder="e.g. Hangs and finishes drywall"
                value={form.workDescription}
                onChange={(e) =>
                  setForm({ ...form, workDescription: e.target.value })
                }
              />
              <p className="text-muted-foreground mt-1 text-xs">
                What this person does by default. Can be overridden per job.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Crew (optional)</Label>
                <Select
                  value={form.crewId || "none"}
                  onValueChange={(v) =>
                    v && setForm({ ...form, crewId: v === "none" ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (in-house)</SelectItem>
                    {crews.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              Rates, contact details, and tax documents are added on the person&apos;s
              page after creation.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!form.firstName.trim() || !form.lastName.trim() || createPerson.isPending}
                onClick={() => createPerson.mutate()}
              >
                {createPerson.isPending ? "Adding…" : "Add person"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
