"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";

const PAY_TYPE_LABELS: Record<string, string> = {
  CONTRACT: "Contract",
  HOURLY: "Hourly",
  PIECEWORK: "Piecework",
};

// "Use the profile default" is a real choice here, distinct from any pay
// type — the Select needs a sentinel because an empty value clears it.
const INHERIT = "__inherit";

type Person = {
  id: string;
  firstName: string;
  lastName: string;
  trade: string | null;
  payType: string;
  workDescription: string | null;
};

type ScopeRow = {
  personnelId: string;
  personnel: { id: string; firstName: string; lastName: string; trade: string | null };
  profile: { payType: string; workDescription: string | null };
  override: { payType: string | null; workDescription: string | null };
  resolved: { payType: string; workDescription: string | null; isOverridden: boolean };
};

export function JobPersonnelScopePanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [personnelId, setPersonnelId] = useState("");
  const [payType, setPayType] = useState(INHERIT);
  const [workDescription, setWorkDescription] = useState("");

  const { data: scopes = [] } = useQuery<ScopeRow[]>({
    queryKey: ["job-personnel-scope", jobId],
    queryFn: () => fetch(`/api/jobs/${jobId}/personnel-scope`).then((r) => r.json()),
  });

  const { data: roster = [] } = useQuery<Person[]>({
    queryKey: ["personnel", "scope-picker"],
    queryFn: () => fetch("/api/personnel?activeOnly=true").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const selected = roster.find((p) => p.id === personnelId);

  const reset = () => {
    setPersonnelId("");
    setPayType(INHERIT);
    setWorkDescription("");
  };

  const saveScope = useMutation({
    mutationFn: async (body: {
      personnelId: string;
      payType: string | null;
      workDescription: string | null;
    }) => {
      const res = await fetch(`/api/jobs/${jobId}/personnel-scope`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-personnel-scope", jobId] });
      reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Pay type &amp; scope on this job</CardTitle>
        <p className="text-muted-foreground text-sm">
          Everyone works to their profile default unless you set something
          different here. Only the people you override are listed.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Label className="text-[11px]">Person</Label>
            <Select
              value={personnelId || undefined}
              onValueChange={(v) => v && setPersonnelId(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a person" />
              </SelectTrigger>
              <SelectContent>
                {roster.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.lastName}, {p.firstName}
                    {p.trade ? ` — ${p.trade}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[150px]">
            <Label className="text-[11px]">Pay type</Label>
            <Select value={payType} onValueChange={(v) => v && setPayType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>
                  {selected
                    ? `Profile default (${PAY_TYPE_LABELS[selected.payType] ?? selected.payType})`
                    : "Profile default"}
                </SelectItem>
                {Object.entries(PAY_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[220px] flex-[2]">
            <Label className="text-[11px]">Work description on this job</Label>
            <Input
              placeholder={selected?.workDescription ?? "e.g. Punch list, 2nd floor"}
              value={workDescription}
              onChange={(e) => setWorkDescription(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={
              !personnelId ||
              saveScope.isPending ||
              (payType === INHERIT && !workDescription.trim())
            }
            onClick={() =>
              saveScope.mutate({
                personnelId,
                payType: payType === INHERIT ? null : payType,
                workDescription: workDescription.trim() || null,
              })
            }
          >
            Save override
          </Button>
        </div>

        {scopes.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No per-job overrides — everyone is on their profile default.
          </p>
        ) : (
          <div className="space-y-2">
            {scopes.map((s) => (
              <div
                key={s.personnelId}
                className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {s.personnel.lastName}, {s.personnel.firstName}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {PAY_TYPE_LABELS[s.resolved.payType] ?? s.resolved.payType}
                    </Badge>
                    {s.override.payType && (
                      <span className="text-muted-foreground text-[10px]">
                        (profile:{" "}
                        {PAY_TYPE_LABELS[s.profile.payType] ?? s.profile.payType})
                      </span>
                    )}
                  </div>
                  {s.resolved.workDescription && (
                    <p className="text-muted-foreground text-xs">
                      {s.resolved.workDescription}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Clear override"
                  disabled={saveScope.isPending}
                  onClick={() =>
                    saveScope.mutate({
                      personnelId: s.personnelId,
                      payType: null,
                      workDescription: null,
                    })
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
