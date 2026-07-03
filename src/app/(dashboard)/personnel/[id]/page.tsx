"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowLeft, Eye, EyeOff, FileText, Trash2, Upload } from "lucide-react";

const EMPLOYMENT_LABELS: Record<string, string> = {
  W2: "Employee (W-2)",
  CONTRACTOR_1099: "Contractor (1099)",
  SUB_CREW: "Sub-crew",
  TEMP: "Temp",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  INACTIVE: "Inactive",
  TERMINATED: "Terminated",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  W9: "W-9",
  GOVERNMENT_ID: "Government ID",
  CERTIFICATION: "Certification",
  OTHER: "Other",
};

type PersonnelDetail = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  trade: string | null;
  title: string | null;
  hourlyRate?: string | null;
  employmentType: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  entityName: string | null;
  crewId: string | null;
  crew: { id: string; name: string } | null;
  notes: string | null;
  isActive: boolean;
  ssnLast4: string | null;
  hasSsn: boolean;
  documents?: {
    id: string;
    type: string;
    fileName: string;
    fileSize: number;
    createdAt: string;
    uploadedBy: { firstName: string; lastName: string };
  }[];
};

type Grants = {
  canViewSensitivePersonnel: boolean;
  canEditPayRates: boolean;
  canSeeLaborCosts: boolean;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function PersonnelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();

  const { data: person, isLoading } = useQuery<PersonnelDetail>({
    queryKey: ["personnel", id],
    queryFn: async () => {
      const res = await fetch(`/api/personnel/${id}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const { data: grants } = useQuery<Grants>({
    queryKey: ["field-grants"],
    queryFn: () => fetch("/api/me/field-grants").then((r) => r.json()),
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!person || dirty) return;
    setForm({
      firstName: person.firstName ?? "",
      lastName: person.lastName ?? "",
      phone: person.phone ?? "",
      email: person.email ?? "",
      address1: person.address1 ?? "",
      address2: person.address2 ?? "",
      city: person.city ?? "",
      state: person.state ?? "",
      zipCode: person.zipCode ?? "",
      emergencyContactName: person.emergencyContactName ?? "",
      emergencyContactPhone: person.emergencyContactPhone ?? "",
      emergencyContactRelation: person.emergencyContactRelation ?? "",
      trade: person.trade ?? "",
      title: person.title ?? "",
      hourlyRate: person.hourlyRate != null ? String(person.hourlyRate) : "",
      employmentType: person.employmentType,
      status: person.status,
      startDate: person.startDate ? person.startDate.slice(0, 10) : "",
      entityName: person.entityName ?? "",
      notes: person.notes ?? "",
    });
  }, [person, dirty]);

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || null,
        email: form.email || null,
        address1: form.address1 || null,
        address2: form.address2 || null,
        city: form.city || null,
        state: form.state || null,
        zipCode: form.zipCode || null,
        emergencyContactName: form.emergencyContactName || null,
        emergencyContactPhone: form.emergencyContactPhone || null,
        emergencyContactRelation: form.emergencyContactRelation || null,
        trade: form.trade || null,
        title: form.title || null,
        employmentType: form.employmentType,
        status: form.status,
        startDate: form.startDate || null,
        entityName: form.entityName || null,
        notes: form.notes || null,
      };
      if (grants?.canEditPayRates) {
        payload.hourlyRate = form.hourlyRate === "" ? null : Number(form.hourlyRate);
      }
      const res = await fetch(`/api/personnel/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["personnel"] });
      toast.success("Saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActive = useMutation({
    mutationFn: async () => {
      const activating = !person?.isActive;
      const res = await fetch(`/api/personnel/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          activating
            ? { isActive: true, status: "ACTIVE" }
            : { isActive: false, status: "INACTIVE" },
        ),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personnel"] });
      toast.success(
        person?.isActive
          ? "Deactivated — hidden from field rosters, history preserved"
          : "Reactivated",
      );
    },
    onError: () => toast.error("Failed to update status"),
  });

  // ── SSN reveal / set ──────────────────────────────────────────────────────
  const [revealedSsn, setRevealedSsn] = useState<string | null>(null);
  const [ssnInput, setSsnInput] = useState("");
  const [editingSsn, setEditingSsn] = useState(false);
  const remaskTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (remaskTimer.current) clearTimeout(remaskTimer.current);
    };
  }, []);

  const reveal = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/personnel/${id}/ssn`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Not authorized");
      }
      return res.json() as Promise<{ ssn: string }>;
    },
    onSuccess: ({ ssn }) => {
      setRevealedSsn(ssn);
      if (remaskTimer.current) clearTimeout(remaskTimer.current);
      // Auto re-mask after 30s; every reveal is audited server-side.
      remaskTimer.current = setTimeout(() => setRevealedSsn(null), 30_000);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveSsn = useMutation({
    mutationFn: async (value: string | null) => {
      const res = await fetch(`/api/personnel/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssn: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save SSN");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personnel", id] });
      setEditingSsn(false);
      setSsnInput("");
      setRevealedSsn(null);
      toast.success("SSN updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Documents ─────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("W9");

  const uploadDoc = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", docType);
      const res = await fetch(`/api/personnel/${id}/documents`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personnel", id] });
      toast.success("Document uploaded");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteDoc = useMutation({
    mutationFn: async (docId: string) => {
      const res = await fetch(`/api/personnel/${id}/documents/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personnel", id] });
      toast.success("Document deleted");
    },
    onError: () => toast.error("Failed to delete document"),
  });

  if (isLoading) {
    return <div className="text-muted-foreground p-6">Loading…</div>;
  }
  if (!person) {
    return <div className="text-muted-foreground p-6">Person not found.</div>;
  }

  const canSensitive = grants?.canViewSensitivePersonnel ?? false;
  const canRates = grants?.canEditPayRates ?? false;
  const showRate = person.hourlyRate !== undefined;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href="/personnel">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" /> Personnel
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">
          {person.firstName} {person.lastName}
        </h1>
        <Badge variant={person.isActive ? "default" : "secondary"}>
          {STATUS_LABELS[person.status] ?? person.status}
        </Badge>
        <div className="flex-1" />
        <Button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
        >
          {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity & Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First name</Label>
                <Input value={form.firstName ?? ""} onChange={(e) => set("firstName", e.target.value)} />
              </div>
              <div>
                <Label>Last name</Label>
                <Input value={form.lastName ?? ""} onChange={(e) => set("lastName", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <Input value={form.address1 ?? ""} onChange={(e) => set("address1", e.target.value)} placeholder="Street" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>City</Label>
                <Input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
              </div>
              <div>
                <Label>State</Label>
                <Input value={form.state ?? ""} onChange={(e) => set("state", e.target.value)} />
              </div>
              <div>
                <Label>ZIP</Label>
                <Input value={form.zipCode ?? ""} onChange={(e) => set("zipCode", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Emergency contact</Label>
                <Input value={form.emergencyContactName ?? ""} onChange={(e) => set("emergencyContactName", e.target.value)} />
              </div>
              <div>
                <Label>Contact phone</Label>
                <Input value={form.emergencyContactPhone ?? ""} onChange={(e) => set("emergencyContactPhone", e.target.value)} />
              </div>
              <div>
                <Label>Relation</Label>
                <Input value={form.emergencyContactRelation ?? ""} onChange={(e) => set("emergencyContactRelation", e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Trade</Label>
                <Input value={form.trade ?? ""} onChange={(e) => set("trade", e.target.value)} />
              </div>
              <div>
                <Label>Title / role on site</Label>
                <Input value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Employment type</Label>
                <Select value={form.employmentType ?? "W2"} onValueChange={(v) => v && set("employmentType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status ?? "ACTIVE"} onValueChange={(v) => v && set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start date</Label>
                <Input type="date" value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value)} />
              </div>
              {showRate && (
                <div>
                  <Label>Hourly rate ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.50"
                    value={form.hourlyRate ?? ""}
                    onChange={(e) => set("hourlyRate", e.target.value)}
                    disabled={!canRates}
                  />
                  {!canRates && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Rate edits require the pay-rate permission.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label>Company / entity</Label>
              <Input
                value={form.entityName ?? ""}
                onChange={(e) => set("entityName", e.target.value)}
                placeholder={person.crew ? `Crew: ${person.crew.name}` : "e.g. ABC Drywall LLC"}
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sensitive Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Social Security Number</Label>
              {person.hasSsn ? (
                <div className="mt-1 flex items-center gap-3">
                  <span className="font-mono text-lg tracking-wider">
                    {revealedSsn
                      ? `${revealedSsn.slice(0, 3)}-${revealedSsn.slice(3, 5)}-${revealedSsn.slice(5)}`
                      : `•••-••-${person.ssnLast4}`}
                  </span>
                  {canSensitive && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (revealedSsn) {
                          setRevealedSsn(null);
                        } else {
                          reveal.mutate();
                        }
                      }}
                      disabled={reveal.isPending}
                    >
                      {revealedSsn ? (
                        <><EyeOff className="mr-1 h-4 w-4" /> Hide</>
                      ) : (
                        <><Eye className="mr-1 h-4 w-4" /> Reveal</>
                      )}
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground mt-1 text-sm">No SSN on file.</p>
              )}
              {revealedSsn && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Re-masks automatically in 30 seconds. This access was logged.
                </p>
              )}
              {canSensitive && (
                <div className="mt-3">
                  {editingSsn ? (
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="123-45-6789"
                        value={ssnInput}
                        onChange={(e) => setSsnInput(e.target.value)}
                        className="max-w-[180px] font-mono"
                        autoComplete="off"
                      />
                      <Button
                        size="sm"
                        disabled={saveSsn.isPending}
                        onClick={() => saveSsn.mutate(ssnInput)}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingSsn(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingSsn(true)}>
                        {person.hasSsn ? "Replace SSN" : "Add SSN"}
                      </Button>
                      {person.hasSsn && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (confirm("Remove the SSN from this record?")) saveSsn.mutate(null);
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {!canSensitive && person.hasSsn && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Full SSN visible only to authorized staff.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Documents (W-9, ID, Certifications)</CardTitle>
          </CardHeader>
          <CardContent>
            {!canSensitive ? (
              <p className="text-muted-foreground text-sm">
                Documents are visible only to authorized staff.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Select value={docType} onValueChange={(v) => v && setDocType(v)}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadDoc.isPending}
                  >
                    <Upload className="mr-1 h-4 w-4" />
                    {uploadDoc.isPending ? "Uploading…" : "Upload"}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadDoc.mutate(file);
                      e.target.value = "";
                    }}
                  />
                </div>
                {(person.documents ?? []).length === 0 ? (
                  <p className="text-muted-foreground text-sm">No documents uploaded.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {(person.documents ?? []).map((doc) => (
                      <li key={doc.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
                        <a
                          href={`/api/personnel/${id}/documents/${doc.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 truncate text-blue-700 hover:underline"
                        >
                          {doc.fileName}
                        </a>
                        <Badge variant="secondary">{DOC_TYPE_LABELS[doc.type] ?? doc.type}</Badge>
                        <span className="text-muted-foreground">{formatBytes(doc.fileSize)}</span>
                        <span className="text-muted-foreground hidden sm:inline">
                          {format(new Date(doc.createdAt), "MMM d, yyyy")}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Delete ${doc.fileName}?`)) deleteDoc.mutate(doc.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-red-200">
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <div className="font-medium">
              {person.isActive ? "Deactivate" : "Reactivate"} this person
            </div>
            <p className="text-muted-foreground text-sm">
              {person.isActive
                ? "Hides them from field rosters. Labor history is preserved."
                : "Makes them selectable on field rosters again."}
            </p>
          </div>
          <Button
            variant={person.isActive ? "destructive" : "default"}
            onClick={() => {
              if (!person.isActive || confirm(`Deactivate ${person.firstName} ${person.lastName}?`)) {
                toggleActive.mutate();
              }
            }}
            disabled={toggleActive.isPending}
          >
            {person.isActive ? "Deactivate" : "Reactivate"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
