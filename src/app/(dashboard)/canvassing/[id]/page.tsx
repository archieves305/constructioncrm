"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Trash2,
  MapPin,
  User,
  Calendar,
  DoorOpen,
} from "lucide-react";

type StopStatus = "PENDING" | "VISITED" | "SKIPPED";

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

const labelize = (s: string) =>
  s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

type Prospect = {
  id: string;
  ownerName: string | null;
  propertyAddress1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  status: string;
  leadId: string | null;
};

type Stop = {
  id: string;
  sortOrder: number;
  status: StopStatus;
  notes: string | null;
  prospect: Prospect;
  knock: { id: string; outcome: string; knockedAt: string } | null;
};

type Route = {
  id: string;
  name: string;
  description: string | null;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "ARCHIVED";
  scheduledFor: string | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  createdBy: { id: string; firstName: string; lastName: string };
  stops: Stop[];
};

type ProspectSearchResult = {
  id: string;
  ownerName: string | null;
  propertyAddress1: string | null;
  city: string | null;
};

const propertyLabel = (p: { ownerName: string | null; propertyAddress1: string | null }) =>
  p.propertyAddress1 || p.ownerName || "Unknown property";

const statusBadgeVariant = (status: string) => {
  switch (status) {
    case "VISITED":
    case "COMPLETED":
      return "default" as const;
    case "IN_PROGRESS":
      return "secondary" as const;
    case "SKIPPED":
    case "ARCHIVED":
      return "outline" as const;
    default:
      return "default" as const;
  }
};

export default function RouteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [knockStop, setKnockStop] = useState<Stop | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["door-knock-route", id] });
    qc.invalidateQueries({ queryKey: ["door-knock-routes"] });
  };

  const {
    data: route,
    isLoading,
    isError,
  } = useQuery<Route>({
    queryKey: ["door-knock-route", id],
    queryFn: async () => {
      const res = await fetch(`/api/door-knock-routes/${id}`);
      if (!res.ok) throw new Error("Failed to load route");
      return res.json();
    },
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const addStops = useMutation({
    mutationFn: async (prospectIds: string[]) => {
      const res = await fetch(`/api/door-knock-routes/${id}/stops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectIds }),
      });
      if (!res.ok) throw new Error("Failed to add prospects");
      return res.json();
    },
    onSuccess: (stops: unknown[]) => {
      toast.success(
        `Added ${stops.length} prospect${stops.length === 1 ? "" : "s"}`,
      );
      setAddOpen(false);
      invalidate();
    },
    onError: () => toast.error("Failed to add prospects"),
  });

  const updateStop = useMutation({
    mutationFn: async ({
      stopId,
      data,
    }: {
      stopId: string;
      data: Record<string, unknown>;
    }) => {
      const res = await fetch(
        `/api/door-knock-routes/${id}/stops/${stopId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error("Failed to update stop");
      return res.json();
    },
    onSuccess: () => invalidate(),
    onError: () => toast.error("Failed to update stop"),
  });

  const removeStop = useMutation({
    mutationFn: async (stopId: string) => {
      const res = await fetch(
        `/api/door-knock-routes/${id}/stops/${stopId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove stop");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Stop removed");
      invalidate();
    },
    onError: () => toast.error("Failed to remove stop"),
  });

  const updateRoute = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/door-knock-routes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update route");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Route updated");
      setEditOpen(false);
      invalidate();
    },
    onError: () => toast.error("Failed to update route"),
  });

  const deleteRoute = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/door-knock-routes/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete route");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Route deleted");
      qc.invalidateQueries({ queryKey: ["door-knock-routes"] });
      router.push("/canvassing");
    },
    onError: () => toast.error("Failed to delete route"),
  });

  // Log a door-knock against the stop's prospect, then link it to the stop and
  // mark the stop visited.
  const logKnock = useMutation({
    mutationFn: async ({
      stop,
      outcome,
      notes,
    }: {
      stop: Stop;
      outcome: Outcome;
      notes: string;
    }) => {
      const res = await fetch(`/api/prospects/${stop.prospect.id}/door-knocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, notes: notes || undefined }),
      });
      if (!res.ok) throw new Error("Failed to log knock");
      const knock = await res.json();
      await fetch(`/api/door-knock-routes/${id}/stops/${stop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knockId: knock.id, status: "VISITED" }),
      });
      return knock;
    },
    onSuccess: () => {
      toast.success("Knock logged");
      setKnockStop(null);
      invalidate();
    },
    onError: () => toast.error("Failed to log knock"),
  });

  if (isLoading) {
    return (
      <p className="text-center text-muted-foreground py-12">Loading route…</p>
    );
  }

  if (isError || !route) {
    return (
      <div className="space-y-4">
        <Link href="/canvassing">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to routes
          </Button>
        </Link>
        <p className="text-center text-muted-foreground py-12">
          Route not found.
        </p>
      </div>
    );
  }

  const stops = [...route.stops].sort((a, b) => a.sortOrder - b.sortOrder);
  const visited = stops.filter((s) => s.status === "VISITED").length;
  const skipped = stops.filter((s) => s.status === "SKIPPED").length;
  const pending = stops.filter((s) => s.status === "PENDING").length;

  return (
    <div className="space-y-6">
      <Link href="/canvassing">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to routes
        </Button>
      </Link>

      <PageHeader
        title={route.name}
        description={route.description || "Canvassing route"}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add Prospects
            </Button>
          </div>
        }
      />

      {/* Summary */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-6 text-sm text-muted-foreground">
          <Badge variant={statusBadgeVariant(route.status)}>
            {route.status.replace("_", " ")}
          </Badge>
          {route.assignedTo && (
            <span className="flex items-center gap-1">
              <User className="h-4 w-4" />
              {route.assignedTo.firstName} {route.assignedTo.lastName}
            </span>
          )}
          {route.scheduledFor && (
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {format(new Date(route.scheduledFor), "MMM d, yyyy")}
            </span>
          )}
          <span className="flex items-center gap-1">
            <MapPin className="h-4 w-4" />
            {stops.length} stops
          </span>
          {stops.length > 0 && (
            <span className="flex gap-2 text-xs">
              <span className="text-green-600">{visited} visited</span>·
              <span className="text-yellow-600">{pending} pending</span>·
              <span className="text-red-600">{skipped} skipped</span>
            </span>
          )}
        </CardContent>
      </Card>

      {/* Stops */}
      {stops.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <DoorOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No stops yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add prospects to this route to start canvassing
            </p>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add Prospects
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {stops.map((stop, idx) => (
            <Card key={stop.id}>
              <CardContent className="flex flex-wrap items-center gap-4 py-4">
                <span className="text-sm font-medium text-muted-foreground w-6">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-[180px]">
                  <div className="font-medium">
                    {propertyLabel(stop.prospect)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {[stop.prospect.city, stop.prospect.state, stop.prospect.zipCode]
                      .filter(Boolean)
                      .join(", ") || "No address"}
                  </div>
                  {stop.prospect.ownerName && stop.prospect.propertyAddress1 && (
                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {stop.prospect.ownerName}
                    </div>
                  )}
                </div>

                {stop.knock && (
                  <Badge variant="outline">
                    {labelize(stop.knock.outcome)}
                  </Badge>
                )}

                <Select
                  value={stop.status}
                  onValueChange={(value) =>
                    updateStop.mutate({ stopId: stop.id, data: { status: value } })
                  }
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="VISITED">Visited</SelectItem>
                    <SelectItem value="SKIPPED">Skipped</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setKnockStop(stop)}
                >
                  <DoorOpen className="mr-2 h-4 w-4" /> Log knock
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => removeStop.mutate(stop.id)}
                  disabled={removeStop.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddProspectsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingProspectIds={stops.map((s) => s.prospect.id)}
        onAdd={(prospectIds) => addStops.mutate(prospectIds)}
        isPending={addStops.isPending}
      />

      <EditRouteDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        route={route}
        onSave={(data) => updateRoute.mutate(data)}
        isPending={updateRoute.isPending}
      />

      <LogKnockDialog
        stop={knockStop}
        onClose={() => setKnockStop(null)}
        onSave={(outcome, notes) =>
          knockStop && logKnock.mutate({ stop: knockStop, outcome, notes })
        }
        isPending={logKnock.isPending}
      />

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this route?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            “{route.name}” and its {stops.length} stop
            {stops.length === 1 ? "" : "s"} will be removed. The prospects
            themselves are kept.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteRoute.mutate()}
              disabled={deleteRoute.isPending}
            >
              {deleteRoute.isPending ? "Deleting…" : "Delete route"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Add-prospects dialog ─────────────────────────────────────────────────────
function AddProspectsDialog({
  open,
  onOpenChange,
  existingProspectIds,
  onAdd,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingProspectIds: string[];
  onAdd: (prospectIds: string[]) => void;
  isPending: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<ProspectSearchResult[]>({
    queryKey: ["prospect-search", search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/prospects?${params}`);
      if (!res.ok) throw new Error("Failed to search prospects");
      return res.json();
    },
    enabled: open,
  });

  const existing = new Set(existingProspectIds);
  const results = (data ?? []).filter((p) => !existing.has(p.id));

  const toggle = (prospectId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(prospectId)) next.delete(prospectId);
      else next.add(prospectId);
      return next;
    });
  };

  const handleAdd = () => {
    if (selected.size === 0) {
      toast.error("Select at least one prospect");
      return;
    }
    onAdd(Array.from(selected));
    setSelected(new Set());
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add prospects to route</DialogTitle>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search prospects by address or owner…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Searching…
              </div>
            ) : (
              <>
                <CommandEmpty>
                  No prospects found. Save some from “Find Properties.”
                </CommandEmpty>
                <CommandGroup>
                  {results.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() => toggle(p.id)}
                      className="flex items-center gap-3"
                    >
                      <Checkbox checked={selected.has(p.id)} />
                      <div className="flex-1">
                        <div className="font-medium">{propertyLabel(p)}</div>
                        <div className="text-xs text-muted-foreground">
                          {[p.ownerName, p.city].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
        <DialogFooter>
          <span className="mr-auto text-sm text-muted-foreground self-center">
            {selected.size} selected
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={isPending}>
            {isPending ? "Adding…" : "Add selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit-route dialog ────────────────────────────────────────────────────────
function EditRouteDialog({
  open,
  onOpenChange,
  route,
  onSave,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  route: Route;
  onSave: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(route.name);
  const [description, setDescription] = useState(route.description ?? "");
  const [status, setStatus] = useState(route.status);
  const [scheduledFor, setScheduledFor] = useState(
    route.scheduledFor ? route.scheduledFor.slice(0, 10) : ""
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit route</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Route Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="edit-desc">Description</Label>
            <Textarea
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="edit-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as Route["status"])}
            >
              <SelectTrigger id="edit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PLANNED">Planned</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-date">Scheduled Date</Label>
            <Input
              id="edit-date"
              type="date"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                name,
                description,
                status,
                scheduledFor: scheduledFor || undefined,
              })
            }
            disabled={isPending || !name.trim()}
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Log-knock dialog ─────────────────────────────────────────────────────────
function LogKnockDialog({
  stop,
  onClose,
  onSave,
  isPending,
}: {
  stop: Stop | null;
  onClose: () => void;
  onSave: (outcome: Outcome, notes: string) => void;
  isPending: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>("NO_ANSWER");
  const [notes, setNotes] = useState("");

  return (
    <Dialog
      open={!!stop}
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
            Log knock{stop ? ` — ${propertyLabel(stop.prospect)}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="knock-outcome">Outcome</Label>
            <Select
              value={outcome}
              onValueChange={(v) => setOutcome(v as Outcome)}
            >
              <SelectTrigger id="knock-outcome">
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
            <Label htmlFor="knock-notes">Notes</Label>
            <Textarea
              id="knock-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this knock"
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
