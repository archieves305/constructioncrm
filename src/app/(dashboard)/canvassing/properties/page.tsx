"use client";

import { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { ArrowLeft, Crosshair, FileText, MapPin, Search } from "lucide-react";
import type { MapPoint } from "@/components/canvassing/property-map";
import { KnockScoreBadge } from "@/components/canvassing/knock-score-badge";
import { CanvasserSummaryModal } from "@/components/canvassing/canvasser-summary-modal";

const PropertyMap = dynamic(
  () => import("@/components/canvassing/property-map"),
  { ssr: false, loading: () => <div className="h-[520px] w-full rounded-md border bg-gray-50" /> },
);

type PropertyRecord = {
  reapiId: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ownerName: string | null;
  ownerOccupied: boolean | null;
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
  yearBuilt: number | null;
  ownedSince: number | null;
  estimatedValue: number | null;
  estimatedEquity: number | null;
  equityPercentage: number | null;
  roofType: string | null;
  estimatedRoofAge: number | null;
  roofAgeBasis: "permit" | "yearBuilt" | "unknown";
  knockScore: number;
  knockScoreTier: string | null;
  priority: "high" | "medium" | "low";
};

type Center = { lat: number; lng: number; label: string };
type RouteOption = { id: string; name: string; totalStops: number };

const RADII = [1, 3, 5, 10, 25];
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString("en-US")}`;

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (res.status === 402) throw new Error("Property-data credit limit reached");
  if (res.status === 503) throw new Error("Property data is not configured");
  if (!res.ok) throw new Error("Property lookup failed");
  return res.json();
}

function toProspectPayload(p: PropertyRecord) {
  return {
    reapiId: p.reapiId,
    ownerName: p.ownerName ?? undefined,
    propertyAddress1: p.address ?? "Unknown",
    city: p.city ?? "Unknown",
    state: p.state ?? "FL",
    zipCode: p.zip ?? undefined,
    latitude: p.latitude ?? undefined,
    longitude: p.longitude ?? undefined,
  };
}

const roofAgeShort = (p: PropertyRecord) =>
  p.estimatedRoofAge == null
    ? "Unknown"
    : p.roofAgeBasis === "permit"
      ? `${p.estimatedRoofAge} yrs`
      : `~${p.estimatedRoofAge} yrs`;

const equityShort = (p: PropertyRecord) =>
  p.estimatedEquity == null
    ? "Unknown"
    : `${money(p.estimatedEquity)}${p.equityPercentage != null ? ` / ${p.equityPercentage}%` : ""}`;

export default function FindPropertiesPage() {
  const [center, setCenter] = useState<Center | null>(null);
  const [radius, setRadius] = useState("5");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summaryReapiId, setSummaryReapiId] = useState<string | null>(null);

  const nearby = useQuery<{ results: PropertyRecord[]; count: number }>({
    queryKey: ["canvassing-properties", center?.lat, center?.lng, radius],
    queryFn: () =>
      fetchJson(
        `/api/canvassing/properties?lat=${center!.lat}&lng=${center!.lng}&radius_miles=${radius}&limit=200`,
      ),
    enabled: !!center,
  });

  const results = useMemo(() => nearby.data?.results ?? [], [nearby.data]);
  const mapped = useMemo(
    () => results.filter((p) => p.latitude != null && p.longitude != null),
    [results],
  );
  const points: MapPoint[] = useMemo(
    () =>
      mapped.map((p) => ({
        id: p.reapiId,
        lat: p.latitude as number,
        lng: p.longitude as number,
        label: `${p.address ?? "Property"} — ${p.knockScore}${p.ownerName ? ` · ${p.ownerName}` : ""}`,
      })),
    [mapped],
  );

  // Drop selections that are no longer in the result set when the search changes.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(results.map((r) => r.reapiId));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [results]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = results.length > 0 && selected.size === results.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(results.map((r) => r.reapiId)));

  const selectedRecords = results.filter((r) => selected.has(r.reapiId));

  const saveOne = useMutation({
    mutationFn: async (rec: PropertyRecord) => {
      const res = await fetch("/api/prospects/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospects: [toProspectPayload(rec)] }),
      });
      if (!res.ok) throw new Error("Failed to save prospect");
      return res.json() as Promise<{ created: number; existing: number }>;
    },
    onSuccess: (r) =>
      toast.success(r.created ? "Saved as prospect" : "Already a prospect"),
    onError: () => toast.error("Failed to save prospect"),
  });

  return (
    <div className="space-y-6">
      <Link href="/canvassing/prospects">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to prospects
        </Button>
      </Link>

      <PageHeader
        title="Find Properties"
        description="Search an area, see properties on the map, and bulk-add as prospects or to a route"
      />

      <CenterBar
        radius={radius}
        onRadius={setRadius}
        onCenter={setCenter}
        currentLabel={center?.label}
      />

      {center && (
        <BulkBar
          selected={selectedRecords}
          allSelected={allSelected}
          onToggleAll={toggleAll}
          onClear={() => setSelected(new Set())}
        />
      )}

      {nearby.isError && (
        <p className="text-sm text-red-600">{(nearby.error as Error).message}</p>
      )}

      {center && (
        <div className="grid gap-4 lg:grid-cols-2">
          <PropertyMap
            center={{ lat: center.lat, lng: center.lng }}
            radiusMiles={Number(radius)}
            points={points}
            selectedIds={selected}
            onToggle={toggle}
          />

          <Card>
            <CardContent className="pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {nearby.isFetching
                    ? "Searching…"
                    : `${results.length} properties · ${selected.size} selected`}
                </span>
                {results.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={toggleAll}>
                    {allSelected ? "Clear all" : "Select all"}
                  </Button>
                )}
              </div>
              <ScrollArea className="h-[460px] pr-3">
                <div className="space-y-2">
                  {results.map((p) => (
                    <div
                      key={p.reapiId}
                      onClick={() => toggle(p.reapiId)}
                      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm hover:bg-gray-50"
                    >
                      <Checkbox
                        checked={selected.has(p.reapiId)}
                        className="pointer-events-none mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{p.address ?? "Property"}</span>
                          <KnockScoreBadge
                            score={p.knockScore}
                            tier={p.knockScoreTier}
                            priority={p.priority}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[p.city, p.state].filter(Boolean).join(", ")}
                          {p.ownerName ? ` · ${p.ownerName}` : ""}
                          {p.ownerOccupied === false && " · Absentee"}
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span>Built: {p.yearBuilt ?? "—"}</span>
                          <span>Owned since: {p.ownedSince ?? "—"}</span>
                          <span>Roof age: {roofAgeShort(p)}</span>
                          <span>Equity: {equityShort(p)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSummaryReapiId(p.reapiId);
                          }}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          <FileText className="h-3.5 w-3.5" /> View Canvasser Summary
                        </button>
                      </div>
                      {p.distanceMiles != null && (
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {p.distanceMiles.toFixed(2)} mi
                        </span>
                      )}
                    </div>
                  ))}
                  {!nearby.isFetching && results.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No properties in this area. Try a wider radius.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}

      {!center && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <MapPin className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Search an address or city, or use your location, to see nearby
              properties.
            </p>
          </CardContent>
        </Card>
      )}

      <CanvasserSummaryModal
        reapiId={summaryReapiId}
        open={!!summaryReapiId}
        onOpenChange={(o) => !o && setSummaryReapiId(null)}
        actions={{
          saveLabel: "Save as prospect",
          onSaveAsLead: () => {
            const rec = results.find((r) => r.reapiId === summaryReapiId);
            if (rec) saveOne.mutate(rec);
          },
        }}
      />
    </div>
  );
}

// ── Center selection: place geocode (Mapbox) + GPS + radius ──────────────────
function CenterBar({
  radius,
  onRadius,
  onCenter,
  currentLabel,
}: {
  radius: string;
  onRadius: (v: string) => void;
  onCenter: (c: Center) => void;
  currentLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const geo = useQuery<
    { features: { place_name: string; center: [number, number] }[] }
  >({
    queryKey: ["mapbox-geocode", debounced],
    queryFn: async () => {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        debounced,
      )}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&country=us&limit=5&types=address,place,postcode,locality,neighborhood`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Geocoding failed");
      return res.json();
    },
    enabled: !!MAPBOX_TOKEN && debounced.length >= 3,
  });

  const locate = () => {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onCenter({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "My location",
        });
        setLocating(false);
      },
      () => {
        toast.error("Location permission denied — allow it and try again");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const pick = (f: { place_name: string; center: [number, number] }) => {
    onCenter({ lat: f.center[1], lng: f.center[0], label: f.place_name });
    setQ("");
    setDebounced("");
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search address, city, or ZIP for the search center…"
              className="pl-8"
            />
            {geo.data?.features?.length ? (
              <div className="absolute z-[1000] mt-1 w-full rounded-md border bg-white shadow-md">
                {geo.data.features.map((f) => (
                  <button
                    key={f.place_name}
                    onClick={() => pick(f)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    {f.place_name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <Button variant="outline" onClick={locate} disabled={locating}>
            <Crosshair className="mr-2 h-4 w-4" />
            {locating ? "Locating…" : "Use my location"}
          </Button>

          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">Radius</Label>
            <Select value={radius} onValueChange={(v) => onRadius(v ?? "5")}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADII.map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {r} mile{r === 1 ? "" : "s"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!MAPBOX_TOKEN && (
          <p className="text-xs text-amber-600">
            Address/city search needs a Mapbox token — use “Use my location” for now.
          </p>
        )}
        {currentLabel && (
          <p className="text-xs text-muted-foreground">
            <MapPin className="mr-1 inline h-3 w-3" />
            Center: {currentLabel}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Bulk actions ──────────────────────────────────────────────────────────────
function BulkBar({
  selected,
  allSelected,
  onToggleAll,
  onClear,
}: {
  selected: PropertyRecord[];
  allSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
}) {
  const [routeOpen, setRouteOpen] = useState(false);

  const saveAsProspects = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/prospects/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospects: selected.map(toProspectPayload) }),
      });
      if (!res.ok) throw new Error("Failed to save prospects");
      return res.json() as Promise<{ ids: string[]; created: number; existing: number }>;
    },
    onSuccess: (r) => {
      toast.success(`Saved ${r.created} new, ${r.existing} already saved`);
      onClear();
    },
    onError: () => toast.error("Failed to save prospects"),
  });

  const disabled = selected.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-gray-50 px-3 py-2">
      <Badge variant="secondary">{selected.length} selected</Badge>
      <Button variant="ghost" size="sm" onClick={onToggleAll}>
        {allSelected ? "Clear all" : "Select all"}
      </Button>
      <div className="ml-auto flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || saveAsProspects.isPending}
          onClick={() => saveAsProspects.mutate()}
        >
          {saveAsProspects.isPending ? "Saving…" : "Add as prospects"}
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => setRouteOpen(true)}>
          Add to route…
        </Button>
      </div>

      <AddToRouteDialog
        open={routeOpen}
        onOpenChange={setRouteOpen}
        selected={selected}
        onDone={onClear}
      />
    </div>
  );
}

function AddToRouteDialog({
  open,
  onOpenChange,
  selected,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selected: PropertyRecord[];
  onDone: () => void;
}) {
  const [routeId, setRouteId] = useState<string | null>(null);

  const routes = useQuery<RouteOption[]>({
    queryKey: ["door-knock-routes", "picker"],
    queryFn: async () => {
      const res = await fetch("/api/door-knock-routes");
      if (!res.ok) throw new Error("Failed to load routes");
      return res.json();
    },
    enabled: open,
  });

  const add = useMutation({
    mutationFn: async () => {
      // 1. Ensure prospects exist (deduped), 2. add them to the route.
      const bulk = await fetch("/api/prospects/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospects: selected.map(toProspectPayload) }),
      });
      if (!bulk.ok) throw new Error("Failed to save prospects");
      const { ids } = (await bulk.json()) as { ids: string[] };

      const res = await fetch(`/api/door-knock-routes/${routeId}/stops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectIds: ids }),
      });
      if (!res.ok) throw new Error("Failed to add to route");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Added to route");
      onOpenChange(false);
      onDone();
    },
    onError: () => toast.error("Failed to add to route"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {selected.length} to a route</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Route</Label>
          <Select value={routeId ?? undefined} onValueChange={(v) => setRouteId(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a route…" />
            </SelectTrigger>
            <SelectContent>
              {(routes.data ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name} ({r.totalStops} stops)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {routes.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No routes yet — create one from the canvassing page first.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => add.mutate()} disabled={!routeId || add.isPending}>
            {add.isPending ? "Adding…" : "Add to route"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
