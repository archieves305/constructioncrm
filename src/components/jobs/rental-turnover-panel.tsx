"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Link2, Unlink, Search, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

type Job = {
  id: string;
  isRentalTurnover: boolean;
  buildiumPropertyId: string | null;
  buildiumUnitId: string | null;
  priorTenantName: string | null;
  turnoverStartedAt: string | null;
  turnoverCompletedAt: string | null;
};

type Candidate = {
  propertyId: string;
  propertyName: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  unitCount: number;
  score: number;
};

type Unit = {
  unitId: string;
  unitNumber: string | null;
  address1: string | null;
};

type MatchResponse = {
  candidates?: Candidate[];
  units?: Unit[];
  error?: string;
};

export function RentalTurnoverPanel({ job }: { job: Job }) {
  const qc = useQueryClient();
  const [priorTenant, setPriorTenant] = useState(job.priorTenantName ?? "");
  const [showFinder, setShowFinder] = useState(false);

  useEffect(() => {
    setPriorTenant(job.priorTenantName ?? "");
  }, [job.id, job.priorTenantName]);

  const patchJob = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", job.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const match = useQuery<MatchResponse>({
    queryKey: ["buildium-match", job.id, job.buildiumPropertyId],
    queryFn: () =>
      fetch(`/api/jobs/${job.id}/buildium/property-match`).then((r) => r.json()),
    enabled: job.isRentalTurnover && showFinder,
    staleTime: 30_000,
  });

  const linkProperty = useMutation({
    mutationFn: async (payload: {
      buildiumPropertyId: string;
      buildiumUnitId?: string | null;
    }) => {
      const res = await fetch(`/api/jobs/${job.id}/buildium/property-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Link failed" }));
        throw new Error(err.error || "Link failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", job.id] });
      qc.invalidateQueries({ queryKey: ["buildium-match", job.id] });
      toast.success("Linked to Buildium property");
      setShowFinder(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlink = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/jobs/${job.id}/buildium/property-match`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Unlink failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", job.id] });
      toast.success("Unlinked");
    },
  });

  const toggleTurnover = (on: boolean) => {
    const patch: Record<string, unknown> = { isRentalTurnover: on };
    if (on && !job.turnoverStartedAt) {
      patch.turnoverStartedAt = new Date().toISOString();
    }
    patchJob.mutate(patch);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Rental turnover
          </span>
          <Checkbox
            checked={job.isRentalTurnover}
            onCheckedChange={(c: boolean) => toggleTurnover(Boolean(c))}
            disabled={patchJob.isPending}
          />
        </CardTitle>
      </CardHeader>
      {job.isRentalTurnover && (
        <CardContent className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Prior tenant</Label>
            <Input
              value={priorTenant}
              onChange={(e) => setPriorTenant(e.target.value)}
              onBlur={() => {
                if (priorTenant !== (job.priorTenantName ?? "")) {
                  patchJob.mutate({ priorTenantName: priorTenant || null });
                }
              }}
              placeholder="Prior tenant name"
            />
          </div>

          {job.buildiumPropertyId ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-emerald-900">
                    Linked to Buildium property
                  </div>
                  <div className="text-xs text-emerald-800">
                    Property ID {job.buildiumPropertyId}
                    {job.buildiumUnitId ? ` · Unit ID ${job.buildiumUnitId}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs text-emerald-900 underline-offset-2 hover:underline"
                  onClick={() => unlink.mutate()}
                  disabled={unlink.isPending}
                >
                  <Unlink className="inline h-3 w-3" /> Unlink
                </button>
              </div>
              {match.data?.units && match.data.units.length > 0 && (
                <div className="mt-2 border-t border-emerald-200 pt-2">
                  <Label className="text-[11px] text-emerald-900">Unit</Label>
                  <select
                    className="mt-1 w-full rounded border border-emerald-300 bg-white p-1 text-xs"
                    value={job.buildiumUnitId ?? ""}
                    onChange={(e) =>
                      linkProperty.mutate({
                        buildiumPropertyId: job.buildiumPropertyId!,
                        buildiumUnitId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">— whole property —</option>
                    {match.data.units.map((u) => (
                      <option key={u.unitId} value={u.unitId}>
                        {u.unitNumber ?? "Unit"} {u.address1 ? `— ${u.address1}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Not linked to a Buildium property. Expenses cannot sync until a
              property is matched.
            </div>
          )}

          <div className="flex justify-between">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowFinder((v) => !v)}
            >
              <Search className="mr-1 h-3 w-3" />
              {showFinder ? "Hide matches" : job.buildiumPropertyId ? "Change property" : "Find Buildium property"}
            </Button>
          </div>

          {showFinder && (
            <div className="space-y-2 rounded-md border bg-gray-50 p-2">
              {match.isLoading && (
                <p className="text-xs text-muted-foreground">
                  Searching Buildium…
                </p>
              )}
              {match.data?.error && (
                <p className="text-xs text-red-700">{match.data.error}</p>
              )}
              {match.isError && !match.data?.error && (
                <p className="text-xs text-red-700">
                  Buildium lookup failed.
                </p>
              )}
              {match.data?.candidates && match.data.candidates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No properties matched this address in Buildium.
                </p>
              )}
              {match.data?.candidates?.map((c) => {
                const isLinked = job.buildiumPropertyId === c.propertyId;
                return (
                  <div
                    key={c.propertyId}
                    className="flex items-start justify-between gap-2 rounded border bg-white p-2"
                  >
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {c.propertyName || "Property"}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            c.score >= 85
                              ? "border-emerald-500 text-emerald-700"
                              : c.score >= 70
                                ? "border-amber-500 text-amber-700"
                                : "border-gray-300 text-gray-600"
                          }
                        >
                          {c.score}% match
                        </Badge>
                      </div>
                      <div className="text-muted-foreground">
                        {[c.address1, c.city, c.state, c.zip]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Buildium ID {c.propertyId}
                        {c.unitCount ? ` · ${c.unitCount} units` : ""}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={isLinked ? "secondary" : "default"}
                      disabled={linkProperty.isPending || isLinked}
                      onClick={() =>
                        linkProperty.mutate({ buildiumPropertyId: c.propertyId })
                      }
                    >
                      <Link2 className="mr-1 h-3 w-3" />
                      {isLinked ? "Linked" : "Link"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
