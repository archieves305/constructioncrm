"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Plus,
  MapPin,
  Calendar,
  User,
  TrendingUp,
  Phone as PhoneIcon,
  Users,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type DoorKnockRoute = {
  id: string;
  name: string;
  description: string | null;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "ARCHIVED";
  scheduledFor: string | null;
  totalDistanceMiles: number | null;
  assignedTo: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
  };
  totalStops: number;
  visitedStops: number;
  skippedStops: number;
  pendingStops: number;
  createdAt: string;
};

type Stats = {
  totals: {
    total: number;
    activeClosers: number;
    conversations: number;
    noContact: number;
  };
  rows: Array<{
    userId: string;
    userName: string;
    total: number;
    properties: number;
    daysActive: number;
    convPct: number;
    assignedRoutes: number;
    lastKnockAt: string | null;
  }>;
};

export default function CanvassingPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DoorKnockRoute | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    name: "",
    description: "",
    scheduledFor: "",
  });

  // Fetch routes
  const { data: routes = [], isLoading: routesLoading } = useQuery<
    DoorKnockRoute[]
  >({
    queryKey: ["door-knock-routes", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/door-knock-routes?${params}`);
      if (!res.ok) throw new Error("Failed to fetch routes");
      return res.json();
    },
  });

  // Fetch stats
  const { data: stats } = useQuery<Stats>({
    queryKey: ["door-knock-stats"],
    queryFn: async () => {
      const res = await fetch("/api/door-knock-routes/stats?days=30");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  // Create route mutation
  const createRouteMutation = useMutation({
    mutationFn: async (data: typeof formState) => {
      const res = await fetch("/api/door-knock-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create route");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Route created successfully");
      qc.invalidateQueries({ queryKey: ["door-knock-routes"] });
      setCreateDialogOpen(false);
      setFormState({ name: "", description: "", scheduledFor: "" });
    },
    onError: () => {
      toast.error("Failed to create route");
    },
  });

  // Delete route mutation (soft delete)
  const deleteRouteMutation = useMutation({
    mutationFn: async (routeId: string) => {
      const res = await fetch(`/api/door-knock-routes/${routeId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete route");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Route deleted");
      qc.invalidateQueries({ queryKey: ["door-knock-routes"] });
      setDeleteTarget(null);
    },
    onError: () => {
      toast.error("Failed to delete route");
    },
  });

  const handleCreateRoute = () => {
    if (!formState.name.trim()) {
      toast.error("Route name is required");
      return;
    }
    createRouteMutation.mutate(formState);
  };

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case "PLANNED":
        return "default";
      case "IN_PROGRESS":
        return "secondary";
      case "COMPLETED":
        return "default";
      case "ARCHIVED":
        return "outline";
      default:
        return "default";
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Canvassing Leads"
        description="Manage door-to-door canvassing routes and track field activity"
        actions={
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Route
          </Button>
        }
      />

      {/* Stats Panel */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Knocks</CardTitle>
              <PhoneIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totals.total}</div>
              <p className="text-xs text-muted-foreground">Last 30 days</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Canvassers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totals.activeClosers}</div>
              <p className="text-xs text-muted-foreground">With recent activity</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Conversations</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totals.conversations}</div>
              <p className="text-xs text-muted-foreground">
                {stats.totals.total > 0
                  ? `${Math.round((stats.totals.conversations / stats.totals.total) * 100)}% contact rate`
                  : "0% contact rate"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">No Contact</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totals.noContact}</div>
              <p className="text-xs text-muted-foreground">Need follow-up</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter Chips */}
      <div className="flex gap-2">
        {["PLANNED", "IN_PROGRESS", "COMPLETED"].map((status) => (
          <Button
            key={status}
            variant={statusFilter === status ? "default" : "outline"}
            size="sm"
            onClick={() =>
              setStatusFilter(statusFilter === status ? null : status)
            }
          >
            {status.replace("_", " ")}
          </Button>
        ))}
      </div>

      {/* Routes List */}
      <div className="grid gap-4">
        {routesLoading ? (
          <p className="text-center text-muted-foreground py-8">
            Loading routes...
          </p>
        ) : routes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No routes yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first canvassing route to get started
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Route
              </Button>
            </CardContent>
          </Card>
        ) : (
          routes.map((route) => (
            <Card
              key={route.id}
              className="cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => router.push(`/canvassing/${route.id}`)}
            >
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold">{route.name}</h3>
                      <Badge variant={statusBadgeVariant(route.status)}>
                        {route.status.replace("_", " ")}
                      </Badge>
                    </div>
                    {route.description && (
                      <p className="text-sm text-muted-foreground mb-3">
                        {route.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      {route.scheduledFor && (
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(route.scheduledFor), "MMM d, yyyy")}
                        </div>
                      )}
                      {route.assignedTo && (
                        <div className="flex items-center gap-1">
                          <User className="h-4 w-4" />
                          {route.assignedTo.firstName} {route.assignedTo.lastName}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {route.totalStops} stops
                        {route.totalDistanceMiles &&
                          ` · ${route.totalDistanceMiles} mi`}
                      </div>
                    </div>
                    {route.totalStops > 0 && (
                      <div className="mt-3 flex gap-2 text-xs">
                        <span className="text-green-600">
                          {route.visitedStops} visited
                        </span>
                        <span className="text-gray-400">·</span>
                        <span className="text-yellow-600">
                          {route.pendingStops} pending
                        </span>
                        <span className="text-gray-400">·</span>
                        <span className="text-red-600">
                          {route.skippedStops} skipped
                        </span>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(route);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Create Route Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Route</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Route Name *</Label>
              <Input
                id="name"
                value={formState.name}
                onChange={(e) =>
                  setFormState({ ...formState, name: e.target.value })
                }
                placeholder="e.g., Downtown Miami Route"
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={formState.description}
                onChange={(e) =>
                  setFormState({ ...formState, description: e.target.value })
                }
                placeholder="Optional notes about this route"
              />
            </div>
            <div>
              <Label htmlFor="scheduledFor">Scheduled Date</Label>
              <Input
                id="scheduledFor"
                type="date"
                value={formState.scheduledFor}
                onChange={(e) =>
                  setFormState({ ...formState, scheduledFor: e.target.value })
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateRoute}
                disabled={createRouteMutation.isPending}
              >
                {createRouteMutation.isPending ? "Creating..." : "Create Route"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Route Confirm */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this route?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            “{deleteTarget?.name}” and its {deleteTarget?.totalStops ?? 0} stop
            {deleteTarget?.totalStops === 1 ? "" : "s"} will be removed. Logged
            door-knocks on the leads are kept.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() =>
                deleteTarget && deleteRouteMutation.mutate(deleteTarget.id)
              }
              disabled={deleteRouteMutation.isPending}
            >
              {deleteRouteMutation.isPending ? "Deleting…" : "Delete route"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
