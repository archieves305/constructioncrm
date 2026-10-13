"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import { useInvalidatePartners, usePartnerOptions, usePartnerSettings, type PartnerSettings } from "@/components/partners/use-partners";

const NONE = "__none";

type Form = Pick<PartnerSettings, "newTargetDays" | "noResponseDays" | "qualSubmittedDays" | "prequalNoBidDays" | "activeQuietDays" | "dormantAfterDays" | "defaultOwnerUserId" | "markets">;

/** Follow-up timing for GC accounts, who gets the tasks by default, and the markets list. */
export default function PartnerSettingsPage() {
  const { data, isLoading } = usePartnerSettings();
  if (isLoading || !data) return <ListSkeleton rows={6} />;
  return <SettingsForm key={data.updatedAt ?? "settings"} data={data} />;
}

function SettingsForm({ data }: { data: PartnerSettings }) {
  const { data: options } = usePartnerOptions();
  const invalidate = useInvalidatePartners();
  const [form, setForm] = useState<Form>(() => ({ newTargetDays: data.newTargetDays, noResponseDays: data.noResponseDays, qualSubmittedDays: data.qualSubmittedDays, prequalNoBidDays: data.prequalNoBidDays, activeQuietDays: data.activeQuietDays, dormantAfterDays: data.dormantAfterDays, defaultOwnerUserId: data.defaultOwnerUserId, markets: data.markets }));
  const [newMarket, setNewMarket] = useState("");

  const save = useMutation({
    mutationFn: (body: Form) => fetchJson<PartnerSettings>("/api/partners/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidate();
      toast.success("Settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canEdit = data.canEdit;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const days = (key: keyof Form, label: string, hint: string, unit = "days") => (
    <div className="grid gap-1 sm:grid-cols-[1fr_8rem] sm:items-center">
      <div>
        <Label htmlFor={`ps-${key}`}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input id={`ps-${key}`} type="number" min={1} className="h-8 w-20" value={Number(form[key])} onChange={(e) => set(key, Number(e.target.value) as never)} disabled={!canEdit} />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
  const owners = [{ value: NONE, label: "The oldest admin" }, ...(options?.owners ?? [])];

  return (
    <div>
      <PageHeader title="Business Development" breadcrumb={[{ label: "Admin" }, { label: "Business Development" }]} description="When the follow-up rules nudge an account's owner, who gets a task when an account has no owner, and the markets accounts are tagged with." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Follow-up rules</CardTitle><p className="text-sm text-muted-foreground">Each raises one ordinary task for the account owner, once, and closes it when an interaction is logged. Nothing is sent to the GC.</p></CardHeader>
          <CardContent className="space-y-4">
            {days("newTargetDays", "New target, nobody has reached out", "Working days after an account is added with no interaction.", "working days")}
            {days("noResponseDays", "No reply to an outbound touch", "Days after a call, email or message that got no answer.")}
            {days("activeQuietDays", "Active partner gone quiet", "Days without any interaction on an Active account.")}
            {days("qualSubmittedDays", "Prequalification submitted, no word", "Days after a submission before \"check its status\" (used once qualifications exist).")}
            {days("prequalNoBidDays", "Prequalified, no bid activity", "Days since approval or the last bid activity (used once bids exist).")}
            {days("dormantAfterDays", "Dormant after", "No interaction for this long caps the relationship score (used once scoring exists).")}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Default owner</CardTitle><p className="text-sm text-muted-foreground">Gets the follow-up tasks of an account that has no relationship owner.</p></CardHeader>
            <CardContent>
              <Select items={owners} value={form.defaultOwnerUserId ?? NONE} onValueChange={(v: string | null) => set("defaultOwnerUserId", !v || v === NONE ? null : v)} disabled={!canEdit}>
                <SelectTrigger className="w-full sm:w-72" aria-label="Default owner"><SelectValue /></SelectTrigger>
                <SelectContent>{owners.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
              </Select>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Markets</CardTitle><p className="text-sm text-muted-foreground">The counties and regions accounts are tagged with and filtered by.</p></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {form.markets.map((m) => (
                  <Badge key={m} variant="outline" className="gap-1">
                    {m}
                    {canEdit && (
                      <button type="button" aria-label={`Remove ${m}`} onClick={() => set("markets", form.markets.filter((x) => x !== m))} className="rounded-full hover:bg-gray-200">
                        <X className="size-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
              {canEdit && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const m = newMarket.trim();
                    if (!m || form.markets.includes(m)) return;
                    set("markets", [...form.markets, m]);
                    setNewMarket("");
                  }}
                >
                  <Input value={newMarket} onChange={(e) => setNewMarket(e.target.value)} placeholder="Monroe" aria-label="New market" maxLength={60} />
                  <Button type="submit" variant="outline" disabled={!newMarket.trim()}>Add</Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save settings"}</Button>
        </div>
      )}
    </div>
  );
}
