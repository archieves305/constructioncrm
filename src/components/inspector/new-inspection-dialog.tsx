"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { JobPicker } from "@/components/shared/job-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson } from "@/lib/fetch-json";
import { INSPECTION_KINDS, KIND_LABEL, PROFILE_LABEL, QUALITY_PROFILES, type InspectionKind, type QualityProfile } from "@/lib/inspector/catalog";

/** Start an inspection: kind, a job (or an address for a Quick inspection), contractor, quality bar, rooms. */
export function NewInspectionDialog({ open, onOpenChange, presetJobId }: { open: boolean; onOpenChange: (v: boolean) => void; presetJobId?: string | null }) {
  const router = useRouter();
  const [kind, setKind] = useState<InspectionKind>("COMPLETION");
  const [jobId, setJobId] = useState<string | null>(presetJobId ?? null);
  const [address, setAddress] = useState("");
  const [profile, setProfile] = useState<QualityProfile | "">("");
  const [contractId, setContractId] = useState<string>("");
  const [areas, setAreas] = useState("");
  const options = useQuery({
    queryKey: ["inspection-options", jobId],
    queryFn: () => fetchJson<{ defaultProfile: QualityProfile; areas: { id: string; name: string }[]; contracts: { id: string; name: string; lines: number }[] }>(`/api/quality-inspections/options${jobId ? `?jobId=${jobId}` : ""}`),
    enabled: open,
  });
  const create = useMutation({
    mutationFn: () =>
      fetchJson<{ id: string }>("/api/quality-inspections", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          kind,
          jobId,
          addressText: jobId ? null : address,
          laborContractId: contractId || null,
          qualityProfile: profile || null,
          areas: areas.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name })),
        }),
      }),
    onSuccess: (r) => router.push(`/field-inspections/${r.id}`),
    onError: (e) => toast.error(String((e as Error).message)),
  });
  const jobAreas = options.data?.areas ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New inspection</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label>What kind</Label>
            <select className="w-full rounded border bg-background px-2 py-2" value={kind} onChange={(e) => setKind(e.target.value as InspectionKind)}>
              {INSPECTION_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Job</Label>
            <JobPicker value={jobId} onChange={(j) => { setJobId(j?.id ?? null); setContractId(""); }} placeholder="No job (Quick inspection)" />
          </div>
          {!jobId ? (
            <div className="space-y-1">
              <Label>Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, unit, city" />
            </div>
          ) : null}
          {jobId && options.data?.contracts.length ? (
            <div className="space-y-1">
              <Label>Contractor (optional)</Label>
              <select className="w-full rounded border bg-background px-2 py-2" value={contractId} onChange={(e) => setContractId(e.target.value)}>
                <option value="">—</option>
                {options.data.contracts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.lines ? ` (${c.lines} line${c.lines === 1 ? "" : "s"} as the scope)` : ""}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label>Quality bar</Label>
            <select className="w-full rounded border bg-background px-2 py-2" value={profile} onChange={(e) => setProfile(e.target.value as QualityProfile | "")}>
              <option value="">Default{options.data ? ` (${PROFILE_LABEL[options.data.defaultProfile]})` : ""}</option>
              {QUALITY_PROFILES.map((p) => (
                <option key={p} value={p}>{PROFILE_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Rooms or areas (optional, comma separated)</Label>
            <Input value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="Kitchen, Bath 1, Front exterior" />
            {jobAreas.length ? (
              <div className="flex flex-wrap gap-1 pt-1">
                {jobAreas.map((a) => (
                  <button key={a.id} type="button" className="rounded border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => setAreas((v) => (v.trim() ? `${v.trim().replace(/,$/, "")}, ${a.name}` : a.name))}>
                    + {a.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={create.isPending || (!jobId && !address.trim())} onClick={() => create.mutate()}>
            {create.isPending ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
