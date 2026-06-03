"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, DoorOpen, MapPin, Search, Trash2, UserPlus } from "lucide-react";

type Outcome =
  | "NO_ANSWER"
  | "SPOKE_WITH_OWNER"
  | "SPOKE_WITH_OCCUPANT"
  | "LEFT_DOOR_HANGER"
  | "VACANT"
  | "HOSTILE"
  | "GATE_BLOCKED"
  | "OTHER";

const OUTCOMES: Outcome[] = [
  "NO_ANSWER",
  "SPOKE_WITH_OWNER",
  "SPOKE_WITH_OCCUPANT",
  "LEFT_DOOR_HANGER",
  "VACANT",
  "HOSTILE",
  "GATE_BLOCKED",
  "OTHER",
];

const STATUSES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "NOT_INTERESTED",
  "PROMOTED",
  "DEAD",
] as const;

const labelize = (s: string) =>
  s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

type Prospect = {
  id: string;
  ownerName: string | null;
  propertyAddress1: string;
  city: string;
  state: string;
  zipCode: string | null;
  status: string;
  leadId: string | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  _count: { knocks: number };
  knocks: { outcome: string; knockedAt: string }[];
};

const statusVariant = (s: string) =>
  s === "PROMOTED"
    ? ("default" as const)
    : s === "DEAD" || s === "NOT_INTERESTED"
      ? ("outline" as const)
      : ("secondary" as const);

export default function ProspectsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [knockProspect, setKnockProspect] = useState<Prospect | null>(null);
  const [promoteProspect, setPromoteProspect] = useState<Prospect | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["prospects"] });

  const { data: prospects = [], isLoading } = useQuery<Prospect[]>({
    queryKey: ["prospects", statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/prospects?${params}`);
      if (!res.ok) throw new Error("Failed to load prospects");
      return res.json();
    },
  });

  const logKnock = useMutation({
    mutationFn: async ({
      prospectId,
      outcome,
      notes,
    }: {
      prospectId: string;
      outcome: Outcome;
      notes: string;
    }) => {
      const res = await fetch(`/api/prospects/${prospectId}/door-knocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, notes: notes || undefined }),
      });
      if (!res.ok) throw new Error("Failed to log knock");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Knock logged");
      setKnockProspect(null);
      invalidate();
    },
    onError: () => toast.error("Failed to log knock"),
  });

  const deleteProspect = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/prospects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete prospect");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Prospect deleted");
      invalidate();
    },
    onError: () => toast.error("Failed to delete prospect"),
  });

  return (
    <div className="space-y-6">
      <Link href="/canvassing">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to canvassing
        </Button>
      </Link>

      <PageHeader
        title="Prospects"
        description="Properties you're canvassing — knock, track, and promote to leads"
        actions={
          <Link href="/canvassing/properties">
            <Button>
              <Search className="mr-2 h-4 w-4" /> Find Properties
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by address or owner…"
          className="max-w-xs"
        />
        {STATUSES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(statusFilter === s ? null : s)}
          >
            {labelize(s)}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-muted-foreground">Loading…</p>
      ) : prospects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MapPin className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">No prospects yet</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Find properties by address or location to start canvassing
            </p>
            <Link href="/canvassing/properties">
              <Button>
                <Search className="mr-2 h-4 w-4" /> Find Properties
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {prospects.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex flex-wrap items-center gap-4 py-4">
                <div className="min-w-[200px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.propertyAddress1}</span>
                    <Badge variant={statusVariant(p.status)}>
                      {labelize(p.status)}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {[p.city, p.state, p.zipCode].filter(Boolean).join(", ")}
                    {p.ownerName ? ` · ${p.ownerName}` : ""}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {p._count.knocks} knock{p._count.knocks === 1 ? "" : "s"}
                    {p.knocks[0] &&
                      ` · last: ${labelize(p.knocks[0].outcome)} (${format(
                        new Date(p.knocks[0].knockedAt),
                        "MMM d",
                      )})`}
                  </div>
                </div>

                {p.leadId ? (
                  <Link href={`/leads/${p.leadId}`}>
                    <Button variant="outline" size="sm">
                      View lead
                    </Button>
                  </Link>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPromoteProspect(p)}
                  >
                    <UserPlus className="mr-2 h-4 w-4" /> Promote
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setKnockProspect(p)}
                >
                  <DoorOpen className="mr-2 h-4 w-4" /> Log knock
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => deleteProspect.mutate(p.id)}
                  disabled={deleteProspect.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <KnockDialog
        prospect={knockProspect}
        onClose={() => setKnockProspect(null)}
        onSave={(outcome, notes) =>
          knockProspect &&
          logKnock.mutate({ prospectId: knockProspect.id, outcome, notes })
        }
        isPending={logKnock.isPending}
      />

      <PromoteDialog
        prospect={promoteProspect}
        onClose={() => setPromoteProspect(null)}
        onPromoted={() => {
          setPromoteProspect(null);
          invalidate();
        }}
      />
    </div>
  );
}

function KnockDialog({
  prospect,
  onClose,
  onSave,
  isPending,
}: {
  prospect: Prospect | null;
  onClose: () => void;
  onSave: (outcome: Outcome, notes: string) => void;
  isPending: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>("NO_ANSWER");
  const [notes, setNotes] = useState("");

  return (
    <Dialog
      open={!!prospect}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setOutcome("NO_ANSWER");
          setNotes("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Log knock{prospect ? ` — ${prospect.propertyAddress1}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="outcome">Outcome</Label>
            <Select value={outcome} onValueChange={(v) => setOutcome(v as Outcome)}>
              <SelectTrigger id="outcome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {labelize(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(outcome, notes)} disabled={isPending}>
            {isPending ? "Saving…" : "Log knock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromoteDialog({
  prospect,
  onClose,
  onPromoted,
}: {
  prospect: Prospect | null;
  onClose: () => void;
  onPromoted: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [primaryPhone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const promote = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/prospects/${prospect!.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          primaryPhone,
          email: email || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to promote");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Promoted to lead");
      onPromoted();
    },
    onError: () => toast.error("Failed to promote — check the phone number"),
  });

  // Seed a best-effort name split from the owner when the dialog opens.
  const reset = () => {
    const parts = (prospect?.ownerName ?? "").trim().split(/\s+/);
    setFirstName(parts[0] ?? "");
    setLastName(parts.slice(1).join(" "));
    setPhone("");
    setEmail("");
  };

  return (
    <Dialog
      open={!!prospect}
      onOpenChange={(o) => {
        if (o) reset();
        else onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote to lead</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {prospect?.propertyAddress1} — creates a CRM lead with this property’s
          address. A phone number is required.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="fn">First name</Label>
            <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ln">Last name</Label>
            <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ph">Phone *</Label>
            <Input id="ph" value={primaryPhone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="em">Email</Label>
            <Input id="em" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => promote.mutate()}
            disabled={
              promote.isPending ||
              !firstName.trim() ||
              !lastName.trim() ||
              primaryPhone.trim().length < 7
            }
          >
            {promote.isPending ? "Promoting…" : "Promote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
