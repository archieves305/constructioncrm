"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Plus,
  Users,
  Hammer,
  MapPin,
  Phone,
  Mail,
  Pencil,
  X as XIcon,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

const COMMON_TRADES = [
  "Roofing",
  "Windows",
  "Doors",
  "Drywall",
  "Interior Renovations",
  "Framing",
  "Electrical",
  "Plumbing",
  "HVAC",
  "Flooring",
  "Painting",
  "Concrete",
  "General",
];

const COMMON_COUNTIES = [
  "Miami-Dade",
  "Broward",
  "Palm Beach",
  "Monroe",
  "Martin",
  "St. Lucie",
  "Indian River",
  "Brevard",
  "Orange",
  "Seminole",
  "Osceola",
  "Hillsborough",
  "Pinellas",
];

type CrewData = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  trades: string[];
  counties: string[];
  isActive: boolean;
  assignments: {
    id: string;
    installDate: string | null;
    job: { id: string; jobNumber: string; title: string; scheduledDate: string | null };
  }[];
};

type FormState = {
  name: string;
  phone: string;
  email: string;
  trades: string[];
  counties: string[];
  isActive: boolean;
};

const emptyForm: FormState = {
  name: "",
  phone: "",
  email: "",
  trades: [],
  counties: [],
  isActive: true,
};

export default function CrewsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [customTrade, setCustomTrade] = useState("");
  const [customCounty, setCustomCounty] = useState("");

  const [search, setSearch] = useState("");
  const [filterTrades, setFilterTrades] = useState<string[]>([]);
  const [filterCounties, setFilterCounties] = useState<string[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  for (const t of filterTrades) params.append("trade", t);
  for (const c of filterCounties) params.append("county", c);
  if (activeOnly) params.set("activeOnly", "true");

  const { data: crews = [], isLoading } = useQuery<CrewData[]>({
    queryKey: ["crews", search, filterTrades.join("|"), filterCounties.join("|"), activeOnly],
    queryFn: () => fetch(`/api/crews?${params.toString()}`).then((r) => r.json()),
  });

  const { data: allCrews = [] } = useQuery<CrewData[]>({
    queryKey: ["crews-all-for-filters"],
    queryFn: () => fetch("/api/crews").then((r) => r.json()),
  });

  const availableTrades = useMemo(() => {
    const set = new Set<string>(COMMON_TRADES);
    for (const c of allCrews) for (const t of c.trades) set.add(t);
    return Array.from(set).sort();
  }, [allCrews]);

  const availableCounties = useMemo(() => {
    const set = new Set<string>(COMMON_COUNTIES);
    for (const c of allCrews) for (const cty of c.counties) set.add(cty);
    return Array.from(set).sort();
  }, [allCrews]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        phone: form.phone,
        email: form.email,
        trades: form.trades,
        counties: form.counties,
        ...(editingId ? { isActive: form.isActive } : {}),
      };
      const url = editingId ? `/api/crews/${editingId}` : "/api/crews";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crews"] });
      qc.invalidateQueries({ queryKey: ["crews-all-for-filters"] });
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      setCustomTrade("");
      setCustomCounty("");
      toast.success(editingId ? "Crew updated" : "Crew created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetch(`/api/crews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crews"] });
      qc.invalidateQueries({ queryKey: ["crews-all-for-filters"] });
      toast.success("Crew updated");
    },
  });

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setCustomTrade("");
    setCustomCounty("");
    setDialogOpen(true);
  }

  function startEdit(c: CrewData) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      phone: c.phone ?? "",
      email: c.email ?? "",
      trades: c.trades ?? [],
      counties: c.counties ?? [],
      isActive: c.isActive,
    });
    setCustomTrade("");
    setCustomCounty("");
    setDialogOpen(true);
  }

  function toggleChip(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function addCustom(
    current: string,
    list: string[],
    setList: (next: string[]) => void,
    clear: () => void,
  ) {
    const v = current.trim();
    if (!v) return;
    if (!list.includes(v)) setList([...list, v]);
    clear();
  }

  const canSave = form.name.trim().length > 0 && form.trades.length > 0;

  return (
    <div>
      <PageHeader
        title="Crews"
        description="Manage installation crews"
        actions={
          <Button onClick={startCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Add Crew
          </Button>
        }
      />

      {/* Search + filters */}
      <Card className="mb-4">
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search by crew name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
              />
              Active only
            </label>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              Trade
              {filterTrades.length > 0 && (
                <button
                  type="button"
                  className="ml-2 text-blue-600 hover:underline"
                  onClick={() => setFilterTrades([])}
                >
                  clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableTrades.map((t) => {
                const on = filterTrades.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFilterTrades((p) => toggleChip(p, t))}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs",
                      on
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-gray-200 bg-white hover:bg-gray-50",
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              County
              {filterCounties.length > 0 && (
                <button
                  type="button"
                  className="ml-2 text-blue-600 hover:underline"
                  onClick={() => setFilterCounties([])}
                >
                  clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableCounties.map((c) => {
                const on = filterCounties.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFilterCounties((p) => toggleChip(p, c))}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs",
                      on
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-gray-200 bg-white hover:bg-gray-50",
                    )}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit / Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Crew" : "New Crew"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Crew name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Alpha Roofing Crew"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Phone</Label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1 555 123 4567"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="foreman@example.com"
                />
              </div>
            </div>

            <div>
              <Label>Trade types</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {COMMON_TRADES.map((t) => {
                  const on = form.trades.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, trades: toggleChip(f.trades, t) }))
                      }
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        on
                          ? "border-blue-500 bg-blue-500 text-white"
                          : "border-gray-200 bg-white hover:bg-gray-50",
                      )}
                    >
                      {t}
                    </button>
                  );
                })}
                {form.trades
                  .filter((t) => !COMMON_TRADES.includes(t))
                  .map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, trades: toggleChip(f.trades, t) }))
                      }
                      className="flex items-center gap-1 rounded-full border border-blue-500 bg-blue-500 px-3 py-1 text-xs text-white"
                    >
                      {t}
                      <XIcon className="h-3 w-3" />
                    </button>
                  ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Input
                  value={customTrade}
                  onChange={(e) => setCustomTrade(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom(
                        customTrade,
                        form.trades,
                        (next) => setForm((f) => ({ ...f, trades: next })),
                        () => setCustomTrade(""),
                      );
                    }
                  }}
                  placeholder="Add another trade…"
                  className="h-9"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    addCustom(
                      customTrade,
                      form.trades,
                      (next) => setForm((f) => ({ ...f, trades: next })),
                      () => setCustomTrade(""),
                    )
                  }
                  disabled={!customTrade.trim()}
                >
                  Add
                </Button>
              </div>
            </div>

            <div>
              <Label>Counties covered</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {COMMON_COUNTIES.map((c) => {
                  const on = form.counties.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, counties: toggleChip(f.counties, c) }))
                      }
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        on
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-gray-200 bg-white hover:bg-gray-50",
                      )}
                    >
                      {c}
                    </button>
                  );
                })}
                {form.counties
                  .filter((c) => !COMMON_COUNTIES.includes(c))
                  .map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, counties: toggleChip(f.counties, c) }))
                      }
                      className="flex items-center gap-1 rounded-full border border-emerald-600 bg-emerald-600 px-3 py-1 text-xs text-white"
                    >
                      {c}
                      <XIcon className="h-3 w-3" />
                    </button>
                  ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Input
                  value={customCounty}
                  onChange={(e) => setCustomCounty(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom(
                        customCounty,
                        form.counties,
                        (next) => setForm((f) => ({ ...f, counties: next })),
                        () => setCustomCounty(""),
                      );
                    }
                  }}
                  placeholder="Add another county…"
                  className="h-9"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    addCustom(
                      customCounty,
                      form.counties,
                      (next) => setForm((f) => ({ ...f, counties: next })),
                      () => setCustomCounty(""),
                    )
                  }
                  disabled={!customCounty.trim()}
                >
                  Add
                </Button>
              </div>
            </div>

            {editingId && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="crew-active"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <Label htmlFor="crew-active" className="cursor-pointer">
                  Active
                </Label>
              </div>
            )}
            <Button
              className="w-full"
              disabled={!canSave || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : editingId ? "Update Crew" : "Create Crew"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : crews.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {search || filterTrades.length > 0 || filterCounties.length > 0
            ? "No crews match your filters."
            : 'No crews yet. Click "Add Crew" to create one.'}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {crews.map((crew) => (
            <Card key={crew.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Users className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <CardTitle className="truncate text-base">{crew.name}</CardTitle>
                  </div>
                  <Badge
                    variant={crew.isActive ? "default" : "secondary"}
                    className="flex-shrink-0 text-xs"
                  >
                    {crew.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Hammer className="h-3 w-3 text-muted-foreground" />
                  {crew.trades.length > 0 ? (
                    crew.trades.map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">
                        {t}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No trades set</span>
                  )}
                </div>
                {crew.counties.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    {crew.counties.map((c) => (
                      <Badge
                        key={c}
                        variant="outline"
                        className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
                      >
                        {c}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {(crew.phone || crew.email) && (
                  <div className="space-y-1 border-b pb-2 text-xs">
                    {crew.phone && (
                      <a
                        href={`tel:${crew.phone}`}
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                      >
                        <Phone className="h-3 w-3" />
                        {crew.phone}
                      </a>
                    )}
                    {crew.email && (
                      <a
                        href={`mailto:${crew.email}`}
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                      >
                        <Mail className="h-3 w-3" />
                        <span className="truncate">{crew.email}</span>
                      </a>
                    )}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  Active Jobs: {crew.assignments.length}
                </div>
                <div className="space-y-1">
                  {crew.assignments.slice(0, 4).map((a) => (
                    <div
                      key={a.id}
                      className="flex cursor-pointer items-center justify-between rounded bg-gray-50 p-1.5 text-xs hover:bg-gray-100"
                      onClick={() => router.push(`/jobs/${a.job.id}`)}
                    >
                      <span className="font-mono">{a.job.jobNumber}</span>
                      {a.installDate && (
                        <span className="text-muted-foreground">
                          {format(new Date(a.installDate), "MMM d")}
                        </span>
                      )}
                    </div>
                  ))}
                  {crew.assignments.length > 4 && (
                    <p className="text-[10px] text-muted-foreground">
                      +{crew.assignments.length - 4} more
                    </p>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => startEdit(crew)}
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-xs"
                    onClick={() =>
                      toggleActive.mutate({ id: crew.id, isActive: !crew.isActive })
                    }
                  >
                    {crew.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
