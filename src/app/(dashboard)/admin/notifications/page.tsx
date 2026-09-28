"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Eye, Play, Save } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/session-client";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import { canManageNotificationSettings } from "@/lib/notifications/access";
import type { TickResult } from "@/lib/notifications/digest/run";
import { toneClasses, type Tone } from "@/lib/ui/tones";

type Settings = {
  enabled: boolean;
  timeZone: string;
  digestWindows: string[];
  weekdaysOnly: boolean;
  catchUpGraceMinutes: number;
  immediateKinds: string[];
  digestOnlyKinds: string[];
  maxImmediatePerUserPerHour: number;
  batchCollapseThreshold: number;
  stormThresholdPer10Min: number;
  digestMaxPerSection: number;
  digestMaxPerSubject: number;
  retentionDays: number;
  lastMorningProducedOn: string | null;
};
type KindRow = { kind: string; label: string; category: string; defaultClass: string; neverDemote: boolean };
type Payload = {
  settings: Settings;
  envEnabled: boolean;
  emailConfigured: boolean;
  dueWindowKey: string | null;
  nextWindowKey: string;
  kinds: KindRow[];
  stats7d: { byClass: Record<string, number>; byState: Record<string, number>; digests: Record<string, number> };
};
type DigestLog = {
  id: string; windowKey: string; status: string; attempts: number; lastError: string | null; sentAt: string | null; subject: string | null;
  itemCount: number; collapsedCount: number; hiddenCount: number; suppressedCount: number; createdAt: string;
  recipient: { firstName: string; lastName: string; email: string };
};
type ImmediateLog = { id: string; kind: string; title: string; state: string; attempts: number; lastError: string | null; emailedAt: string | null; createdAt: string; classifyReason: string; recipient: { firstName: string; lastName: string } };

const json = (method: string, body?: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const errMsg = (e: unknown, fb: string) => (e instanceof HttpError && (e.body as { error?: string })?.error) || (e instanceof Error ? e.message : fb);
const when = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, h:mm a") : "—");
const STATUS_TONE: Record<string, Tone> = { SENT: "success", PENDING: "info", SENDING: "info", FAILED: "danger", SKIPPED_EMPTY: "neutral", SKIPPED_MUTED: "neutral", CLAIMED: "info", SUPPRESSED: "neutral" };

export default function NotificationsAdminPage() {
  const { data: session } = useSession();
  const isAdmin = session ? canManageNotificationSettings(session.user.role) : false;
  const [tab, setTab] = useState<"delivery" | "kinds" | "log">("delivery");
  const { data, isLoading, error } = useQuery<Payload>({ queryKey: ["notification-settings"], queryFn: () => fetchJson("/api/admin/notifications/settings"), retry: retryServerErrors });

  return (
    <div>
      <PageHeader title="Notification Digests" description="Routine activity folds into a few emails a day; urgent things still go right away. One record powers the bell and the mail." />
      {error ? (
        <Callout tone="danger">Couldn&apos;t load the settings: {errMsg(error, "unknown error")}</Callout>
      ) : isLoading || !data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <>
          <StatusStrip data={data} />
          <div className="my-4">
            <SegmentedControl<"delivery" | "kinds" | "log">
              ariaLabel="Notification settings section"
              value={tab}
              onValueChange={setTab}
              options={[
                { value: "delivery", label: "Delivery" },
                { value: "kinds", label: "Immediate rules" },
                { value: "log", label: "Log" },
              ]}
            />
          </div>
          {/* Keyed on the saved settings so a fresh load resets the form without an effect. */}
          {tab === "delivery" && <DeliveryTab key={JSON.stringify(data.settings)} data={data} isAdmin={isAdmin} />}
          {tab === "kinds" && <KindsTab key={JSON.stringify(data.settings)} data={data} isAdmin={isAdmin} />}
          {tab === "log" && <LogTab />}
        </>
      )}
    </div>
  );
}

function StatusStrip({ data }: { data: Payload }) {
  const mode = !data.envEnabled ? "off" : data.settings.enabled ? "on" : "shadow";
  const tone: Tone = mode === "on" ? "success" : mode === "shadow" ? "warning" : "neutral";
  const c = toneClasses(tone);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.pill}`}>
        {mode === "on" ? "Digests are delivering" : mode === "shadow" ? "Shadow mode: recording, legacy mail still sends" : "Off: nothing recorded"}
      </span>
      <span className="text-muted-foreground">
        env {data.envEnabled ? "on" : "off"} · switch {data.settings.enabled ? "on" : "off"} · email {data.emailConfigured ? "configured" : "not configured"} · window now {data.dueWindowKey ?? "none"} · next {data.nextWindowKey}
      </span>
      <span className="text-muted-foreground">
        · last 7 days: {Object.entries(data.stats7d.byClass).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ") || "no rows yet"}
        {Object.keys(data.stats7d.digests).length ? ` · digests ${Object.entries(data.stats7d.digests).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ")}` : ""}
      </span>
    </div>
  );
}

function DeliveryTab({ data, isAdmin }: { data: Payload; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings>(data.settings);
  const [windows, setWindows] = useState(data.settings.digestWindows.join(", "));
  const [preview, setPreview] = useState<TickResult | null>(null);

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => fetchJson<{ settings: Settings }>("/api/admin/notifications/settings", json("PUT", patch)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
      toast.success("Saved");
    },
    onError: (e) => toast.error(errMsg(e, "Could not save")),
  });
  const tick = useMutation({
    mutationFn: (dryRun: boolean) => fetchJson<TickResult>(`/api/admin/notifications/tick?dryRun=${dryRun ? "1" : "0"}`, json("POST")),
    onSuccess: (r, dryRun) => {
      setPreview(r);
      if (!dryRun) {
        qc.invalidateQueries({ queryKey: ["notification-settings"] });
        qc.invalidateQueries({ queryKey: ["notification-log"] });
        toast.success(`Tick ran: ${r.digest.sent} sent, ${r.digest.skippedEmpty} empty, ${r.digest.failed} failed`);
      }
    },
    onError: (e) => toast.error(errMsg(e, "Could not run the tick")),
  });

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }));
  const submit = () => {
    const digestWindows = windows.split(/[,\s]+/).map((w) => w.trim()).filter(Boolean);
    const { lastMorningProducedOn: _l, immediateKinds: _i, digestOnlyKinds: _d, ...rest } = form;
    void _l;
    void _i;
    void _d;
    save.mutate({ ...rest, digestWindows });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery switch</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data.envEnabled && <Callout tone="warning">The deploy flag `NOTIFICATIONS_V2` is off on this server, so nothing is recorded and this switch has no effect.</Callout>}
          {data.envEnabled && !data.settings.enabled && (
            <Callout tone="info" title="Shadow mode">
              Every event is recorded and shows in the bell, but email still goes the old way. Switching on hands delivery to the digests: routine mail stops arriving one at a time and arrives at the times below instead.
            </Callout>
          )}
          <label className="flex items-start gap-3 text-sm">
            <Checkbox className="mt-0.5" checked={form.enabled} disabled={!isAdmin} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: Boolean(v) }))} />
            <span>
              <span className="font-medium">Digest delivery on</span>
              <span className="block text-xs text-muted-foreground">Off = legacy per-event mail. Switching off again is instant and loses nothing: rows keep recording.</span>
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Digest times (HH:MM, company time)</Label>
              <Input value={windows} onChange={(e) => setWindows(e.target.value)} disabled={!isAdmin} placeholder="08:00, 12:00, 15:30, 18:00" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Time zone</Label>
              <Input value={form.timeZone} onChange={(e) => setForm((f) => ({ ...f, timeZone: e.target.value }))} disabled={!isAdmin} className="mt-1" />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={form.weekdaysOnly} disabled={!isAdmin} onCheckedChange={(v) => setForm((f) => ({ ...f, weekdaysOnly: Boolean(v) }))} /> Weekdays only (weekend activity waits for Monday morning; urgent mail still goes)
            </label>
            <div>
              <Label className="text-xs">Catch-up grace (minutes)</Label>
              <Input type="number" value={form.catchUpGraceMinutes} onChange={num("catchUpGraceMinutes")} disabled={!isAdmin} className="mt-1" />
              <p className="mt-0.5 text-[11px] text-muted-foreground">How long after a time the tick may still send that digest.</p>
            </div>
            <div>
              <Label className="text-xs">Keep rows for (days)</Label>
              <Input type="number" value={form.retentionDays} onChange={num("retentionDays")} disabled={!isAdmin} className="mt-1" />
            </div>
          </div>
          {isAdmin && (
            <Button onClick={submit} disabled={save.isPending}>
              <Save className="size-4" /> {save.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Immediate mails per person per hour</Label>
              <Input type="number" value={form.maxImmediatePerUserPerHour} onChange={num("maxImmediatePerUserPerHour")} disabled={!isAdmin} className="mt-1" />
              <p className="mt-0.5 text-[11px] text-muted-foreground">Past this, the rest wait for the next digest (mentions, nudges and escalations excepted).</p>
            </div>
            <div>
              <Label className="text-xs">Collapse an engine batch from</Label>
              <Input type="number" value={form.batchCollapseThreshold} onChange={num("batchCollapseThreshold")} disabled={!isAdmin} className="mt-1" />
              <p className="mt-0.5 text-[11px] text-muted-foreground">Steps from one workflow run become one digest line at this size.</p>
            </div>
            <div>
              <Label className="text-xs">Storm threshold (rows / 10 min)</Label>
              <Input type="number" value={form.stormThresholdPer10Min} onChange={num("stormThresholdPer10Min")} disabled={!isAdmin} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Digest: subjects per section · items per subject</Label>
              <div className="mt-1 flex gap-2">
                <Input type="number" value={form.digestMaxPerSection} onChange={num("digestMaxPerSection")} disabled={!isAdmin} />
                <Input type="number" value={form.digestMaxPerSubject} onChange={num("digestMaxPerSubject")} disabled={!isAdmin} />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Saved with the Delivery card&apos;s Save button.</p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Preview the next digest</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => tick.mutate(true)} disabled={tick.isPending || !data.envEnabled}>
              <Eye className="size-4" /> Preview (sends nothing)
            </Button>
            {isAdmin && data.settings.enabled && (
              <Button size="sm" onClick={() => tick.mutate(false)} disabled={tick.isPending}>
                <Play className="size-4" /> Run the tick now
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!preview ? (
            <p className="text-sm text-muted-foreground">Shows what each person would get for the window that is due now (or the next one), with the subject line and counts. In shadow mode it lists the rows waiting.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {preview.dryRun ? "Preview" : "Run"} · window {preview.windowKey ?? `none due (next ${preview.nextWindowKey})`} · {preview.takeover ? "digests deliver" : "shadow"} · {preview.digest.people} {preview.digest.people === 1 ? "person" : "people"} · {preview.digest.pending} rows
                {preview.digest.staleRecovered ? ` · ${preview.digest.staleRecovered} stale recovered` : ""}
                {preview.pruned ? ` · ${preview.pruned} pruned` : ""}
              </p>
              {preview.digest.perUser.length === 0 ? (
                <EmptyState title="Nothing waiting" description="No pending digest rows for this window." />
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Person</th>
                      <th className="py-1 pr-3">Subject</th>
                      <th className="py-1 pr-3">Rows</th>
                      <th className="py-1 pr-3">Items</th>
                      <th className="py-1 pr-3">Agenda</th>
                      <th className="py-1">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.digest.perUser.map((p) => (
                      <tr key={p.userId}>
                        <td className="py-1.5 pr-3">{p.name || p.email}</td>
                        <td className="py-1.5 pr-3">{p.subject ?? <span className="text-muted-foreground">{Object.entries(p.kinds).map(([k, v]) => `${v} ${k}`).join(", ") || "—"}</span>}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{p.pending}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{p.itemCount ?? "—"}{p.suppressed ? ` (${p.suppressed} hidden)` : ""}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{p.agendaItems ?? "—"}</td>
                        <td className="py-1.5">
                          <Badge className={`border-0 ${toneClasses(p.outcome === "sent" || p.outcome === "planned" ? "success" : p.outcome === "failed" ? "danger" : "neutral").pill}`}>{p.outcome ?? "pending"}</Badge>
                          {p.error && <span className="ml-2 text-xs text-red-700">{p.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KindsTab({ data, isAdmin }: { data: Payload; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [imm, setImm] = useState(new Set(data.settings.immediateKinds));
  const [never, setNever] = useState(new Set(data.settings.digestOnlyKinds));
  const save = useMutation({
    mutationFn: () => fetchJson("/api/admin/notifications/settings", json("PUT", { immediateKinds: Array.from(imm), digestOnlyKinds: Array.from(never) })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
      toast.success("Saved");
    },
    onError: (e) => toast.error(errMsg(e, "Could not save")),
  });
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, other: Set<string>, otherSetter: (s: Set<string>) => void, kind: string) => {
    const next = new Set(set);
    if (next.has(kind)) next.delete(kind);
    else {
      next.add(kind);
      if (other.has(kind)) {
        const o = new Set(other);
        o.delete(kind);
        otherSetter(o);
      }
    }
    setter(next);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What goes out right away</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Each kind has a default. &quot;Always&quot; forces it to send immediately; &quot;Never&quot; keeps it in the digest even when it would have jumped. Mentions, nudges and escalations are never demoted by caps.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-1 pr-3">Kind</th>
              <th className="py-1 pr-3">Category</th>
              <th className="py-1 pr-3">Default</th>
              <th className="py-1 pr-3">Always immediate</th>
              <th className="py-1">Never immediate</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.kinds.map((k) => (
              <tr key={k.kind}>
                <td className="py-1.5 pr-3">
                  {k.label} <span className="font-mono text-[11px] text-muted-foreground">{k.kind}</span>
                </td>
                <td className="py-1.5 pr-3 text-muted-foreground">{k.category}</td>
                <td className="py-1.5 pr-3">
                  <Badge className={`border-0 ${toneClasses(k.defaultClass === "IMMEDIATE" ? "warning" : k.defaultClass === "DIGEST" ? "info" : "neutral").pill}`}>{k.defaultClass}</Badge>
                </td>
                <td className="py-1.5 pr-3">
                  <Checkbox checked={imm.has(k.kind)} disabled={!isAdmin} onCheckedChange={() => toggle(imm, setImm, never, setNever, k.kind)} aria-label={`${k.label}: always immediate`} />
                </td>
                <td className="py-1.5">
                  <Checkbox checked={never.has(k.kind)} disabled={!isAdmin || k.neverDemote} onCheckedChange={() => toggle(never, setNever, imm, setImm, k.kind)} aria-label={`${k.label}: never immediate`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && (
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="size-4" /> {save.isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function LogTab() {
  const { data, isLoading } = useQuery<{ digests: DigestLog[]; immediates: ImmediateLog[] }>({ queryKey: ["notification-log"], queryFn: () => fetchJson("/api/admin/notifications/log"), retry: retryServerErrors });
  if (isLoading || !data) return <Skeleton className="h-48 rounded-xl" />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Digests</CardTitle>
        </CardHeader>
        <CardContent>
          {data.digests.length === 0 ? (
            <EmptyState title="No digests yet" description="Rows appear here once delivery is switched on and a window comes due." />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Window</th>
                  <th className="py-1 pr-3">Person</th>
                  <th className="py-1 pr-3">Subject</th>
                  <th className="py-1 pr-3">Items</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.digests.map((d) => (
                  <tr key={d.id}>
                    <td className="py-1.5 pr-3 font-mono text-xs">{d.windowKey}</td>
                    <td className="py-1.5 pr-3">{d.recipient.firstName} {d.recipient.lastName}</td>
                    <td className="py-1.5 pr-3">{d.subject ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{d.itemCount}{d.collapsedCount ? ` (${d.collapsedCount} collapsed)` : ""}{d.hiddenCount ? ` +${d.hiddenCount}` : ""}{d.suppressedCount ? ` · ${d.suppressedCount} hidden` : ""}</td>
                    <td className="py-1.5 pr-3">
                      <Badge className={`border-0 ${toneClasses(STATUS_TONE[d.status] ?? "neutral").pill}`}>{d.status}</Badge>
                      {d.lastError && <span className="ml-2 text-xs text-red-700">{d.lastError}</span>}
                    </td>
                    <td className="py-1.5 tabular-nums">{when(d.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Immediate mail</CardTitle>
        </CardHeader>
        <CardContent>
          {data.immediates.length === 0 ? (
            <EmptyState title="No immediate rows yet" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">When</th>
                  <th className="py-1 pr-3">Person</th>
                  <th className="py-1 pr-3">Kind</th>
                  <th className="py-1 pr-3">Title</th>
                  <th className="py-1 pr-3">Why</th>
                  <th className="py-1">State</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.immediates.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-3 tabular-nums">{when(r.createdAt)}</td>
                    <td className="py-1.5 pr-3">{r.recipient.firstName} {r.recipient.lastName}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{r.kind}</td>
                    <td className="py-1.5 pr-3">{r.title}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{r.classifyReason}</td>
                    <td className="py-1.5">
                      <Badge className={`border-0 ${toneClasses(STATUS_TONE[r.state] ?? "neutral").pill}`}>{r.state}</Badge>
                      {r.lastError && <span className="ml-2 text-xs text-red-700">{r.lastError}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
