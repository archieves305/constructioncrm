"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ArrowLeft, MapPin, Search, Crosshair, Home, Plus } from "lucide-react";

type PropertyRecord = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  owner_name: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  year_built: number | null;
  property_type: string | null;
  roof_type: string | null;
  last_sale_date: string | null;
  last_sale_amount: number | null;
  outstanding_mortgages: number | null;
  estimated_value: number | null;
  distance_miles?: number | null;
};

type AutocompleteResult = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

const money = (n: number | null) =>
  n === null ? "—" : `$${n.toLocaleString("en-US")}`;

const RADII = [1, 3, 5, 10, 25];

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (res.status === 402) throw new Error("Property-data credit limit reached");
  if (res.status === 503) throw new Error("Property data is not configured");
  if (!res.ok) throw new Error("Property lookup failed");
  return res.json();
}

export default function FindPropertiesPage() {
  const [tab, setTab] = useState("address");
  const [selected, setSelected] = useState<PropertyRecord | null>(null);

  return (
    <div className="space-y-6">
      <Link href="/canvassing">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to canvassing
        </Button>
      </Link>

      <PageHeader
        title="Find Properties"
        description="Search by address or location, then save as a canvassing prospect"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="address">
              <Search className="mr-2 h-4 w-4" /> Address
            </TabsTrigger>
            <TabsTrigger value="nearby">
              <Crosshair className="mr-2 h-4 w-4" /> Near me
            </TabsTrigger>
          </TabsList>
          <TabsContent value="address">
            <AddressSearch onPick={setSelected} selectedId={selected?.id} />
          </TabsContent>
          <TabsContent value="nearby">
            <NearbySearch onPick={setSelected} selectedId={selected?.id} />
          </TabsContent>
        </Tabs>

        <PropertyDetail property={selected} />
      </div>
    </div>
  );
}

// ── Address autocomplete ──────────────────────────────────────────────────────
function AddressSearch({
  onPick,
  selectedId,
}: {
  onPick: (p: PropertyRecord) => void;
  selectedId?: string;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching, isError, error } = useQuery<{
    results: AutocompleteResult[];
  }>({
    queryKey: ["zylow-autocomplete", debounced],
    queryFn: () =>
      fetchJson(`/api/zylow/autocomplete?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 3,
  });

  // Load full detail when a suggestion is picked.
  const pick = useMutation({
    mutationFn: (reapiId: string) =>
      fetchJson(`/api/zylow/property/${reapiId}`) as Promise<PropertyRecord>,
    onSuccess: onPick,
    onError: (e: Error) => toast.error(e.message),
  });

  const results = data?.results ?? [];

  return (
    <div className="space-y-3 pt-4">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Start typing an address (3+ characters)…"
        autoFocus
      />
      {q.trim().length > 0 && q.trim().length < 3 && (
        <p className="text-xs text-muted-foreground">Keep typing…</p>
      )}
      {isError && (
        <p className="text-sm text-red-600">{(error as Error).message}</p>
      )}
      {isFetching && (
        <p className="text-sm text-muted-foreground">Searching…</p>
      )}
      <div className="space-y-2">
        {results.map((r) => (
          <button
            key={r.id}
            onClick={() => pick.mutate(r.id)}
            className={`flex w-full items-start gap-2 rounded-md border p-3 text-left text-sm hover:bg-gray-50 ${
              selectedId === r.id ? "border-primary bg-gray-50" : ""
            }`}
          >
            <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <span>
              <span className="font-medium">{r.address}</span>
              <span className="block text-xs text-muted-foreground">
                {[r.city, r.state, r.zip].filter(Boolean).join(", ")}
              </span>
            </span>
          </button>
        ))}
        {debounced.length >= 3 && !isFetching && results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No matches — this address may not be in the index yet.
          </p>
        )}
      </div>
    </div>
  );
}

// ── GPS nearby ────────────────────────────────────────────────────────────────
function NearbySearch({
  onPick,
  selectedId,
}: {
  onPick: (p: PropertyRecord) => void;
  selectedId?: string;
}) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState("5");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const locate = () => {
    setGeoError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setGeoError("Location permission denied — allow it and try again.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const { data, isFetching, isError, error } = useQuery<{
    results: PropertyRecord[];
    count: number;
  }>({
    queryKey: ["zylow-nearby", coords?.lat, coords?.lng, radius],
    queryFn: () =>
      fetchJson(
        `/api/zylow/nearby?lat=${coords!.lat}&lng=${coords!.lng}&radius_miles=${radius}&limit=100`,
      ),
    enabled: !!coords,
  });

  const results = data?.results ?? [];

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center gap-2">
        <Button onClick={locate} disabled={locating}>
          <Crosshair className="mr-2 h-4 w-4" />
          {locating ? "Locating…" : "Use my location"}
        </Button>
        <Select value={radius} onValueChange={(v) => setRadius(v ?? "5")}>
          <SelectTrigger className="w-[130px]">
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

      {geoError && <p className="text-sm text-red-600">{geoError}</p>}
      {isError && (
        <p className="text-sm text-red-600">{(error as Error).message}</p>
      )}
      {coords && (
        <p className="text-xs text-muted-foreground">
          {isFetching
            ? "Searching nearby…"
            : `${data?.count ?? 0} properties within ${radius} mi`}
        </p>
      )}

      <div className="space-y-2">
        {results.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className={`flex w-full items-start justify-between gap-2 rounded-md border p-3 text-left text-sm hover:bg-gray-50 ${
              selectedId === p.id ? "border-primary bg-gray-50" : ""
            }`}
          >
            <span>
              <span className="font-medium">{p.address}</span>
              <span className="block text-xs text-muted-foreground">
                {[p.city, p.state].filter(Boolean).join(", ")}
                {p.owner_name ? ` · ${p.owner_name}` : ""}
              </span>
            </span>
            {p.distance_miles != null && (
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {p.distance_miles.toFixed(2)} mi
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Detail + save-as-prospect ─────────────────────────────────────────────────
function PropertyDetail({ property }: { property: PropertyRecord | null }) {
  const save = useMutation({
    mutationFn: async (p: PropertyRecord) => {
      const res = await fetch("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reapiId: p.id,
          ownerName: p.owner_name ?? undefined,
          propertyAddress1: p.address ?? "Unknown",
          city: p.city ?? "Unknown",
          state: p.state ?? "FL",
          zipCode: p.zip ?? undefined,
          county: p.county ?? undefined,
          latitude: p.latitude ?? undefined,
          longitude: p.longitude ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to save prospect");
      return res.json();
    },
    onSuccess: () => toast.success("Saved as prospect"),
    onError: () => toast.error("Failed to save prospect"),
  });

  if (!property) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Home className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Pick a property to see details
          </p>
        </CardContent>
      </Card>
    );
  }

  const rows: [string, string][] = [
    ["Owner", property.owner_name ?? "—"],
    [
      "Beds / Baths",
      `${property.bedrooms ?? "—"} / ${property.bathrooms ?? "—"}`,
    ],
    ["Sqft", property.sqft?.toLocaleString("en-US") ?? "—"],
    ["Year built", property.year_built?.toString() ?? "—"],
    ["Type", property.property_type ?? "—"],
    ["Roof", property.roof_type ?? "—"],
    ["Est. value", money(property.estimated_value)],
    ["Last sale", property.last_sale_date?.slice(0, 10) ?? "—"],
    ["Last sale amt", money(property.last_sale_amount)],
    ["Mortgages", money(property.outstanding_mortgages)],
  ];

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h3 className="text-lg font-semibold">{property.address}</h3>
          <p className="text-sm text-muted-foreground">
            {[property.city, property.state, property.zip]
              .filter(Boolean)
              .join(", ")}
            {property.county ? ` · ${property.county}` : ""}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between border-b py-1">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium text-right">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => save.mutate(property)}
            disabled={save.isPending || save.isSuccess}
          >
            <Plus className="mr-2 h-4 w-4" />
            {save.isSuccess
              ? "Saved"
              : save.isPending
                ? "Saving…"
                : "Save as prospect"}
          </Button>
          {save.isSuccess && (
            <Link href="/canvassing/prospects">
              <Button variant="outline">View prospects</Button>
            </Link>
          )}
          {property.latitude != null && (
            <Badge variant="outline" className="ml-auto">
              <MapPin className="mr-1 h-3 w-3" />
              {property.latitude.toFixed(4)}, {property.longitude?.toFixed(4)}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
