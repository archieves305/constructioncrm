"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Eye, Pause, Pencil, Play, Plus, Send, Square, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/lib/auth/session-client";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import { TEMPLATE_VARIABLES } from "@/lib/templates/render";
import { toneClasses, type Tone } from "@/lib/ui/tones";
import { canManageNurture } from "@/lib/nurture/access";
import type { PlannedSend } from "@/lib/nurture/run";
import Link from "next/link";

type Settings = {
  enabled: boolean;
  followUpDays: number[];
  followUpEveryDaysAfter: number;
  nurtureDays: number[];
  nurtureEveryDaysAfter: number;
  nurtureMonthlyOffsetDays: number;
  minGapHours: number;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  timeZone: string;
  weekdaysOnly: boolean;
  personalTouchSkipDays: number;
  repPromptAfterDays: number;
  excludedStageIds: string[];
};
type SettingsPayload = { settings: Settings; envEnabled: boolean; emailConfigured: boolean; maxPerRun: number; stages: { id: string; name: string }[]; counts: Record<string, number> };
type Content = { id: string; kind: "FOLLOW_UP" | "NURTURE"; step: number | null; seedKey: string | null; subject: string; body: string; category: string | null; sortOrder: number; isActive: boolean; sentCount: number; editedAt: string | null };
type QueueRow = {
  id: string;
  leadId: string;
  status: "ACTIVE" | "PAUSED" | "STOPPED";
  stoppedReason: string | null;
  pausedReason: string | null;
  followUpStep: number;
  nurtureSlot: number;
  nextFollowUpAt: string | null;
  nextNurtureAt: string | null;
  lastAutoEmailAt: string | null;
  lastPersonalTouchAt: string | null;
  sharedEmail: boolean;
  lead: { id: string; fullName: string; email: string | null; currentStage: { name: string }; assignedUser: { firstName: string; lastName: string } | null };
  sends: { kind: string; status: string; subject: string; sentAt: string | null; createdAt: string }[];
};
type SendRow = { id: string; kind: "FOLLOW_UP" | "NURTURE"; status: "SENT" | "FAILED" | "SKIPPED"; subject: string; toEmail: string; sentAt: string | null; createdAt: string; error: string | null; lead: { id: string; fullName: string } };
type RunResult = { enabled: boolean; envEnabled: boolean; settingsEnabled: boolean; emailConfigured: boolean; enrolled: number; stopped: number; due: number; planned: number; skipped: number; prompts: number; plan: PlannedSend[] };

const STATUS_TONE: Record<QueueRow["status"], Tone> = { ACTIVE: "success", PAUSED: "warning", STOPPED: "neutral" };
const json = (method: string, body?: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const errMsg = (e: unknown, fb: string) => (e instanceof HttpError && (e.body as { error?: string })?.error) || (e instanceof Error ? e.message : fb);
const when = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, h:mm a") : "—");
const dayList = (s: string) => s.split(/[,\s]+/).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);

export default function NurtureAdminPage() {
  const { data: session } = useSession();
  const isAdmin = session ? canManageNurture(session.user.role) : false;
  const [tab, setTab] = useState<"cadence" | "library" | "queue" | "log">("cadence");
  const { data, isLoading, error } = useQuery<SettingsPayload>({ queryKey: ["nurture-settings"], queryFn: () => fetchJson("/api/admin/nurture/settings"), retry: retryServerErrors });

  return (
    <div>
      <PageHeader
        title="Customer Nurture"
        description="Automated follow-ups and between-the-lines company emails to open leads, from the rep's name, until a lead is Won or Lost."
        actions={
          <SegmentedControl
            ariaLabel="Section"
            value={tab}
            onValueChange={setTab}
            options={[
              { value: "cadence", label: "Cadence" },
              { value: "library", label: "Library" },
              { value: "queue", label: `Queue${data?.counts?.ACTIVE ? ` (${data.counts.ACTIVE})` : ""}` },
              { value: "log", label: "Log" },
            ]}
          />
        }
      />
      {error ? (
        <Callout tone="danger" title="Couldn't load nurture settings">{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <StatusBanner data={data} />
          {tab === "cadence" && <CadenceTab data={data} isAdmin={isAdmin} />}
          {tab === "library" && <LibraryTab isAdmin={isAdmin} />}
          {tab === "queue" && <QueueTab isAdmin={isAdmin} timeZone={data.settings.timeZone} />}
          {tab === "log" && <LogTab />}
        </>
      )}
    </div>
  );
}

function StatusBanner({ data }: { data: SettingsPayload }) {
  const live = data.envEnabled && data.settings.enabled && data.emailConfigured;
  return (
    <Callout tone={live ? "success" : "warning"} className="mb-4" title={live ? "Sending is live" : "Not sending yet"}>
      Deploy gate (NURTURE_ENABLED): <b>{data.envEnabled ? "on" : "off"}</b> · Operator switch: <b>{data.settings.enabled ? "on" : "off"}</b> · Email provider: <b>{data.emailConfigured ? "configured" : "missing"}</b> · Cap per run: {data.maxPerRun}.
      {!live && " Use “Preview today's run” on the Queue tab to see exactly what would go out. Add the domain's SPF record before switching on."}
    </Callout>
  );
}

function CadenceTab({ data, isAdmin }: { data: SettingsPayload; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings>(data.settings);
  const [fuText, setFuText] = useState(data.settings.followUpDays.join(", "));
  const [nuText, setNuText] = useState(data.settings.nurtureDays.join(", "));
  const save = useMutation({
    mutationFn: (body: Settings) => fetchJson<{ settings: Settings; recomputed: number }>("/api/admin/nurture/settings", json("PUT", body)),
    onSuccess: (r) => {
      toast.success(`Saved — ${r.recomputed} enrolled lead${r.recomputed === 1 ? "" : "s"} rescheduled`);
      qc.invalidateQueries({ queryKey: ["nurture-settings"] });
    },
    onError: (e) => toast.error(errMsg(e, "Could not save")),
  });
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }));
  const submit = () => save.mutate({ ...form, followUpDays: dayList(fuText), nurtureDays: dayList(nuText) });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Follow-ups (from the rep, &ldquo;checking in&rdquo;)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Days after the anchor</Label>
            <Input value={fuText} disabled={!isAdmin} onChange={(e) => setFuText(e.target.value)} placeholder="2, 7, 14, 30" />
            <p className="mt-1 text-xs text-muted-foreground">The anchor is the latest of: lead created, stage changed, estimate sent, contract sent, or a personal touch (which keeps the step but restarts the clock).</p>
          </div>
          <div>
            <Label className="text-xs">Then every N days</Label>
            <Input type="number" min={7} value={form.followUpEveryDaysAfter} disabled={!isAdmin} onChange={num("followUpEveryDaysAfter")} />
          </div>
          <div>
            <Label className="text-xs">Skip a follow-up when the rep touched the lead within N days</Label>
            <Input type="number" min={0} value={form.personalTouchSkipDays} disabled={!isAdmin} onChange={num("personalTouchSkipDays")} />
          </div>
          <div>
            <Label className="text-xs">Prompt the rep for a personal touch after N quiet days</Label>
            <Input type="number" min={1} value={form.repPromptAfterDays} disabled={!isAdmin} onChange={num("repPromptAfterDays")} />
            <p className="mt-1 text-xs text-muted-foreground">Raises a task on the rep (it shows in the morning digest); closed when a communication is logged.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Nurture (company, tips — not salesy)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Days after enrolment</Label>
            <Input value={nuText} disabled={!isAdmin} onChange={(e) => setNuText(e.target.value)} placeholder="4, 10, 21" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Then every N days</Label>
              <Input type="number" min={7} value={form.nurtureEveryDaysAfter} disabled={!isAdmin} onChange={num("nurtureEveryDaysAfter")} />
            </div>
            <div>
              <Label className="text-xs">Offset from the monthly follow-up</Label>
              <Input type="number" min={1} value={form.nurtureMonthlyOffsetDays} disabled={!isAdmin} onChange={num("nurtureMonthlyOffsetDays")} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Pieces go out in library order, never twice to the same lead; when the library runs out, nurture pauses until new pieces are added. The nurture clock is never re-anchored.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Timing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Window start (hour)</Label>
              <Input type="number" min={0} max={23} value={form.sendWindowStartHour} disabled={!isAdmin} onChange={num("sendWindowStartHour")} />
            </div>
            <div>
              <Label className="text-xs">Window end (hour)</Label>
              <Input type="number" min={1} max={24} value={form.sendWindowEndHour} disabled={!isAdmin} onChange={num("sendWindowEndHour")} />
            </div>
            <div>
              <Label className="text-xs">Min. gap between emails (h)</Label>
              <Input type="number" min={0} value={form.minGapHours} disabled={!isAdmin} onChange={num("minGapHours")} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Time zone</Label>
            <Input value={form.timeZone} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, timeZone: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2">
            <Checkbox checked={form.weekdaysOnly} disabled={!isAdmin} onCheckedChange={(c) => setForm((f) => ({ ...f, weekdaysOnly: Boolean(c) }))} /> Weekdays only
          </label>
          <p className="text-xs text-muted-foreground">The daily run happens once each weekday morning; anything due before it goes out then. Keep the window at least two hours wide so the clock change does not push the run outside it.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Who is excluded</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1.5">
            {data.stages.map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <Checkbox
                  checked={form.excludedStageIds.includes(s.id)}
                  disabled={!isAdmin}
                  onCheckedChange={(c) => setForm((f) => ({ ...f, excludedStageIds: c ? [...f.excludedStageIds, s.id] : f.excludedStageIds.filter((x) => x !== s.id) }))}
                />
                {s.name}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Leads in a ticked stage are paused (and resume when they move). Won, Lost and opted-out leads always stop.</p>
          <div className="border-t pt-3">
            <label className="flex items-center gap-2 font-medium">
              <Checkbox checked={form.enabled} disabled={!isAdmin} onCheckedChange={(c) => setForm((f) => ({ ...f, enabled: Boolean(c) }))} /> Sending switched on
            </label>
            <p className="mt-1 text-xs text-muted-foreground">Needs the deploy gate too (see the banner). Off = the run still enrols and reconciles, sends nothing.</p>
          </div>
          {isAdmin && (
            <Button variant="brand" disabled={save.isPending} onClick={submit}>
              Save cadence
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LibraryTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery<Content[]>({ queryKey: ["nurture-content"], queryFn: () => fetchJson("/api/admin/nurture/content"), retry: retryServerErrors });
  const [editing, setEditing] = useState<Partial<Content> | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nurture-content"] });

  const save = useMutation({
    mutationFn: (c: Partial<Content>) => (c.id ? fetchJson(`/api/admin/nurture/content/${c.id}`, json("PUT", c)) : fetchJson("/api/admin/nurture/content", json("POST", c))),
    onSuccess: () => {
      toast.success("Saved");
      invalidate();
      setEditing(null);
    },
    onError: (e) => toast.error(errMsg(e, "Could not save")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/admin/nurture/content/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Deleted");
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e, "Could not delete")),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => fetchJson("/api/admin/nurture/content", json("PUT", { ids })),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errMsg(e, "Could not reorder")),
  });
  const previewIt = useMutation({
    mutationFn: async (c: Partial<Content>) => fetchJson<{ subject: string; html: string }>(`/api/admin/nurture/content/${c.id ?? "draft"}/preview`, json("POST", { subject: c.subject, body: c.body })),
    onSuccess: (r) => setPreview(r),
    onError: (e) => toast.error(errMsg(e, "Preview failed")),
  });
  const testSend = useMutation({
    mutationFn: async (c: Partial<Content>) => fetchJson<{ sentTo: string }>(`/api/admin/nurture/content/${c.id ?? "draft"}/preview?send=1`, json("POST", { subject: c.subject, body: c.body })),
    onSuccess: (r) => toast.success(`Test sent to ${r.sentTo}`),
    onError: (e) => toast.error(errMsg(e, "Test send failed")),
  });

  const groups = useMemo(
    () => ({
      FOLLOW_UP: rows.filter((r) => r.kind === "FOLLOW_UP").sort((a, b) => (a.step ?? 0) - (b.step ?? 0)),
      NURTURE: rows.filter((r) => r.kind === "NURTURE").sort((a, b) => a.sortOrder - b.sortOrder),
    }),
    [rows],
  );
  const move = (list: Content[], i: number, dir: -1 | 1) => {
    const ids = list.map((r) => r.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };

  return (
    <div className="space-y-4">
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        (["FOLLOW_UP", "NURTURE"] as const).map((kind) => (
          <Card key={kind}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm">{kind === "FOLLOW_UP" ? "Follow-up steps" : "Nurture pieces (sent in this order)"}</CardTitle>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setEditing({ kind, step: kind === "FOLLOW_UP" ? groups.FOLLOW_UP.length + 1 : null, subject: "", body: "", isActive: true })}>
                  <Plus className="size-4" /> Add
                </Button>
              )}
            </CardHeader>
            <CardContent className="divide-y p-0">
              {groups[kind].length === 0 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">Nothing yet.</p>
              ) : (
                groups[kind].map((c, i) => (
                  <div key={c.id} className={`flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm ${c.isActive ? "" : "opacity-60"}`}>
                    <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{kind === "FOLLOW_UP" ? `#${c.step}` : i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{c.subject}</span>
                    {c.category && <Badge variant="outline" className="text-[11px]">{c.category}</Badge>}
                    {!c.isActive && <Badge variant="outline" className="text-[11px]">inactive</Badge>}
                    {c.editedAt && <Badge variant="outline" className="text-[11px]">edited</Badge>}
                    <span className="text-xs text-muted-foreground">sent {c.sentCount}</span>
                    <Button size="icon" variant="ghost" aria-label="Preview" onClick={() => previewIt.mutate(c)}>
                      <Eye className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Send test to me" onClick={() => testSend.mutate(c)}>
                      <Send className="size-4" />
                    </Button>
                    {isAdmin && (
                      <>
                        {kind === "NURTURE" && (
                          <>
                            <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(groups.NURTURE, i, -1)}>
                              <ArrowUp className="size-4" />
                            </Button>
                            <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === groups.NURTURE.length - 1} onClick={() => move(groups.NURTURE, i, 1)}>
                              <ArrowDown className="size-4" />
                            </Button>
                          </>
                        )}
                        <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(c)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: c.id, isActive: !c.isActive })}>
                          {c.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        {c.sentCount === 0 && (
                          <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => confirm(`Delete "${c.subject}"?`) && remove.mutate(c.id)}>
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit piece" : "New piece"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-[1fr_140px_160px]">
                <div>
                  <Label className="text-xs">Subject</Label>
                  <Input value={editing.subject ?? ""} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
                </div>
                {editing.kind === "FOLLOW_UP" ? (
                  <div>
                    <Label className="text-xs">Step</Label>
                    <Input type="number" min={1} value={editing.step ?? 1} onChange={(e) => setEditing({ ...editing, step: Number(e.target.value) })} />
                  </div>
                ) : (
                  <div>
                    <Label className="text-xs">Category</Label>
                    <Input value={editing.category ?? ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
                  </div>
                )}
                <div>
                  <Label className="text-xs">Kind</Label>
                  <Select value={editing.kind ?? "NURTURE"} onValueChange={(v: string | null) => v && setEditing({ ...editing, kind: v as Content["kind"] })}>
                    <SelectTrigger>
                      <SelectValue>{(v: string) => (v === "FOLLOW_UP" ? "Follow-up" : "Nurture")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FOLLOW_UP">Follow-up</SelectItem>
                      <SelectItem value="NURTURE">Nurture</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Body (markdown; blank line = paragraph)</Label>
                <Textarea rows={12} value={editing.body ?? ""} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                <div className="mt-1 flex flex-wrap gap-1">
                  {TEMPLATE_VARIABLES.filter((v) => !v.startsWith("permit.") && !v.startsWith("inspection.")).map((v) => (
                    <button key={v} type="button" className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent" onClick={() => setEditing({ ...editing, body: `${editing.body ?? ""}{{${v}}}` })}>
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => previewIt.mutate(editing)}>
                  <Eye className="mr-1 size-4" /> Preview
                </Button>
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button variant="brand" disabled={save.isPending || !editing.subject?.trim() || !editing.body?.trim()} onClick={() => save.mutate(editing)}>
                  Save
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{preview?.subject}</DialogTitle>
          </DialogHeader>
          {preview && <iframe title="Preview" srcDoc={preview.html} className="h-[70vh] w-full rounded border bg-white" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QueueTab({ isAdmin, timeZone }: { isAdmin: boolean; timeZone: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"" | "ACTIVE" | "PAUSED" | "STOPPED">("");
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery<{ data: QueueRow[]; total: number }>({
    queryKey: ["nurture-queue", status, q],
    queryFn: () => fetchJson(`/api/admin/nurture/queue?status=${status}&q=${encodeURIComponent(q)}&pageSize=100`),
    retry: retryServerErrors,
  });
  const [run, setRun] = useState<RunResult | null>(null);
  const previewRun = useMutation({
    mutationFn: () => fetchJson<RunResult>("/api/admin/nurture/preview-run", { method: "POST" }),
    onSuccess: (r) => setRun(r),
    onError: (e) => toast.error(errMsg(e, "Preview failed")),
  });
  const act = useMutation({
    mutationFn: ({ leadId, action }: { leadId: string; action: "pause" | "resume" | "stop" }) => fetchJson(`/api/leads/${leadId}/nurture`, json("POST", { action })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture-queue"] }),
    onError: (e) => toast.error(errMsg(e, "Could not update")),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel="Status"
          size="sm"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "", label: "All" },
            { value: "ACTIVE", label: "Active" },
            { value: "PAUSED", label: "Paused" },
            { value: "STOPPED", label: "Stopped" },
          ]}
        />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="h-8 max-w-xs" />
        <span className="text-xs text-muted-foreground">{data?.total ?? 0} lead{data?.total === 1 ? "" : "s"} · times in {timeZone}</span>
        <Button size="sm" variant="outline" className="ml-auto" disabled={previewRun.isPending} onClick={() => previewRun.mutate()}>
          <Play className="size-4" /> Preview today&rsquo;s run
        </Button>
      </div>

      {run && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Dry run · would enrol {run.enrolled}, stop {run.stopped}, send {run.planned} of {run.due} due, skip {run.skipped}, prompt {run.prompts} rep{run.prompts === 1 ? "" : "s"}
              {!run.enabled && <span className="ml-2 text-xs font-normal text-muted-foreground">(sending is off — nothing goes out)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 overflow-auto p-0">
            {run.plan.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">Nothing to do right now.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {run.plan.map((p, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">
                        <Link href={`/leads/${p.leadId}`} className="font-medium hover:underline">
                          {p.leadName}
                        </Link>
                        <span className="ml-1 text-muted-foreground">{p.email}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge variant="outline" className="text-[11px]">{p.kind}</Badge>
                      </td>
                      <td className="px-3 py-1.5">{p.subject ?? <span className="text-muted-foreground">{p.reason}</span>}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{p.subject ? p.reason : ""}{p.rep ? ` · from ${p.rep}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data || data.data.length === 0 ? (
        <EmptyState title="No enrolled leads" description="Open leads with an email address are enrolled by the morning run." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">Stage · rep</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Next follow-up</th>
                  <th className="px-3 py-2">Next nurture</th>
                  <th className="px-3 py-2">Last automated</th>
                  <th className="px-3 py-2">Last personal</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-3 py-2">
                      <Link href={`/leads/${r.leadId}`} className="font-medium hover:underline">
                        {r.lead.fullName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {r.lead.email}
                        {r.sharedEmail && <Badge variant="outline" className="ml-1 text-[10px]">shared address</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.lead.currentStage.name}
                      <div className="text-muted-foreground">{r.lead.assignedUser ? `${r.lead.assignedUser.firstName} ${r.lead.assignedUser.lastName}` : "Unassigned"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClasses(STATUS_TONE[r.status]).pill}`}>{r.status.toLowerCase()}</span>
                      {(r.pausedReason || r.stoppedReason) && <div className="text-[11px] text-muted-foreground">{(r.pausedReason ?? r.stoppedReason)?.replace("_", " ")}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.status === "ACTIVE" ? `${when(r.nextFollowUpAt)} · step ${r.followUpStep + 1}` : "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.status === "ACTIVE" ? when(r.nextNurtureAt) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{when(r.lastAutoEmailAt)}</td>
                    <td className="px-3 py-2 text-xs">{when(r.lastPersonalTouchAt)}</td>
                    <td className="px-3 py-2">
                      {isAdmin && (
                        <div className="flex gap-1">
                          {r.status === "ACTIVE" && (
                            <Button size="icon" variant="ghost" aria-label="Pause" onClick={() => act.mutate({ leadId: r.leadId, action: "pause" })}>
                              <Pause className="size-4" />
                            </Button>
                          )}
                          {r.status === "PAUSED" && (
                            <Button size="icon" variant="ghost" aria-label="Resume" onClick={() => act.mutate({ leadId: r.leadId, action: "resume" })}>
                              <Play className="size-4" />
                            </Button>
                          )}
                          {r.status !== "STOPPED" && (
                            <Button size="icon" variant="ghost" aria-label="Stop" onClick={() => confirm(`Stop automated emails to ${r.lead.fullName}?`) && act.mutate({ leadId: r.leadId, action: "stop" })}>
                              <Square className="size-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogTab() {
  const { data: rows = [], isLoading } = useQuery<SendRow[]>({ queryKey: ["nurture-sends"], queryFn: () => fetchJson("/api/admin/nurture/sends?limit=200"), retry: retryServerErrors, refetchInterval: 60_000 });
  if (isLoading) return <Skeleton className="h-64" />;
  if (rows.length === 0) return <EmptyState title="Nothing sent yet" description="Every automated email, skip and failure lands here." />;
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="px-3 py-2 text-xs">{when(r.sentAt ?? r.createdAt)}</td>
                <td className="px-3 py-2">
                  <Link href={`/leads/${r.lead.id}`} className="hover:underline">
                    {r.lead.fullName}
                  </Link>
                  <div className="text-xs text-muted-foreground">{r.toEmail}</div>
                </td>
                <td className="px-3 py-2 text-xs">{r.kind === "FOLLOW_UP" ? "Follow-up" : "Nurture"}</td>
                <td className="px-3 py-2">{r.subject || <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClasses(r.status === "SENT" ? "success" : r.status === "FAILED" ? "danger" : "neutral").pill}`}>{r.status.toLowerCase()}</span>
                  {r.error && <div className="max-w-xs truncate text-[11px] text-muted-foreground" title={r.error}>{r.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
