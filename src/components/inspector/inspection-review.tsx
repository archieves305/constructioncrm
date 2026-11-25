"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Check, Loader2, Pencil, RotateCcw, Search, Square, Wrench, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { QueryState } from "@/components/shared/query-state";
import { JobPicker } from "@/components/shared/job-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";
import { useConfirm } from "@/components/shared/confirm-provider";
import { uploadForm } from "@/components/workflows/use-task-file-upload";
import { PROFILE_LABEL, TRADES, isQualityProfile } from "@/lib/inspector/catalog";
import { DISMISS_LABEL, DISMISS_REASONS, SEVERITY_LABEL, type DismissReason, type Severity } from "@/lib/inspector/state";
import type { InspectionView } from "@/lib/inspector/service";
import { PhotoWithBoxes, type OverlayBox } from "./photo-boxes";

type Finding = InspectionView["findings"][number];
type Photo = InspectionView["photos"][number];
type Box = { x1: number; y1: number; x2: number; y2: number };

const SEVERITIES: Severity[] = ["CRITICAL", "MAJOR", "MINOR", "COSMETIC"];
const KIND_TEXT: Record<string, string> = {
  OBSERVED: "Seen",
  SUSPECTED: "Suspected",
  DOCUMENTATION: "Needs a photo",
  SCOPE: "Scope",
  PHYSICAL_CHECK: "Needs a physical check",
  CANNOT_DETERMINE: "Cannot tell",
};
const VERDICT_TEXT: Record<string, string> = { looks_complete: "Looks complete", issues_found: "Issues found", cannot_tell: "Cannot tell from the photos" };
const tone = (f: Finding): OverlayBox["tone"] => (f.review === "DISMISSED" || f.resolved ? "muted" : f.severity === "CRITICAL" ? "critical" : f.severity === "MAJOR" ? "major" : "minor");
const sevVariant = (s: string): "destructive" | "default" | "secondary" | "outline" => (s === "CRITICAL" ? "destructive" : s === "MAJOR" ? "default" : s === "MINOR" ? "secondary" : "outline");

const send = (url: string, method: string, body?: unknown) =>
  fetchJson(url, { method, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });

export function InspectionReview({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["inspection", id],
    queryFn: () => fetchJson<InspectionView>(`/api/quality-inspections/${id}`),
    refetchInterval: (query) => {
      const d = query.state.data as InspectionView | undefined;
      return d && (d.pendingAnalyses > 0 || d.photos.some((p) => p.state === "waiting" || p.state === "analysing")) ? 3000 : false;
    },
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["inspection", id] });
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [activeFinding, setActiveFinding] = useState<string | null>(null);
  const [drawFor, setDrawFor] = useState<string | "new" | null>(null);
  const [newBox, setNewBox] = useState<Box | null>(null);

  const d = q.data;
  const numbers = useMemo(() => new Map((d?.findings ?? []).map((f, i) => [f.id, i + 1])), [d?.findings]);
  const photo = d?.photos.find((p) => p.id === photoId) ?? d?.photos[0] ?? null;

  // a link to #f-<id> opens on that finding's photo
  useEffect(() => {
    if (!d || typeof window === "undefined") return;
    const m = window.location.hash.match(/^#f-(.+)$/);
    const f = m ? d.findings.find((x) => x.id === m[1]) : null;
    if (f) {
      setActiveFinding(f.id);
      if (f.photoId) setPhotoId(f.photoId);
    }
    // only once the data first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!d]);

  if (!d) return <div className="p-6"><QueryState query={q} noun="inspection" back={{ href: "/field-inspections", label: "All inspections" }} /></div>;

  const r = d.rights;
  const onPhoto = (p: Photo) => d.findings.filter((f) => f.photoId === p.id && f.boxes.length);
  const overlay: OverlayBox[] = photo
    ? onPhoto(photo).flatMap((f) => f.boxes.map((b, i) => ({ key: `${f.id}:${i}`, n: numbers.get(f.id)!, ...b, tone: tone(f), active: f.id === activeFinding })))
    : [];
  const unpunched = d.findings.filter((f) => f.review === "CONFIRMED" && !f.punch && !f.resolved).length;
  const place = d.job?.label ?? d.addressText ?? "No address";

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader
        title={place}
        back={{ href: "/field-inspections", label: "Inspections" }}
        badge={<Badge variant={d.phase === "review" ? "destructive" : "secondary"}>{d.phaseLabel}</Badge>}
        description={[d.number, d.kindLabel, d.laborContract?.name, isQualityProfile(d.qualityProfile) ? PROFILE_LABEL[d.qualityProfile] : null, d.startedBy ? `started by ${d.startedBy}` : null].filter(Boolean).join(" · ")}
        actions={<Actions d={d} unpunched={unpunched} onDone={refresh} />}
      />
      <p className="text-xs text-muted-foreground">
        A visual workmanship review from photographs. It is not a building-code, permit or engineering inspection, and the AI&apos;s findings are proposals until a person confirms them.
        {d.job ? <> · Job <Link className="underline" href={`/jobs/${d.job.id}`}>{d.job.code ?? "open"}</Link></> : null}
        {d.aiCostUsd != null ? ` · AI cost so far $${d.aiCostUsd.toFixed(2)}` : ""}
      </p>
      {d.status === "ACCEPTED" ? (
        <div className="rounded border border-tone-success bg-tone-success-soft p-3 text-sm">
          Accepted by {d.acceptedBy} {d.acceptedAt ? new Date(d.acceptedAt).toLocaleString() : ""}
          {d.acceptOverride ? <> — with open items: “{d.acceptOverride}”</> : null}
        </div>
      ) : null}
      {d.status === "OPEN" && (d.blockers.hard.length || d.blockers.overridable.length) ? (
        <ul className="rounded border bg-muted/30 p-3 text-sm">
          {[...d.blockers.hard, ...d.blockers.overridable].map((b) => (
            <li key={b}>• {b}</li>
          ))}
        </ul>
      ) : null}
      {!d.job && r.canEdit ? <AttachJob id={d.id} onDone={refresh} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-3">
          {photo ? (
            <div className="space-y-2">
              <PhotoWithBoxes
                url={photo.url}
                width={photo.width}
                height={photo.height}
                boxes={overlay}
                alt={`Photo in ${d.areas.find((a) => a.id === photo.areaId)?.name ?? "the inspection"}`}
                onSelect={(key) => setActiveFinding(key.split(":")[0])}
                onDraw={
                  drawFor
                    ? (b) => {
                        if (drawFor === "new") setNewBox(b);
                        else
                          void send(`/api/quality-findings/${drawFor}`, "PATCH", { op: "edit", boxes: [b] })
                            .then(() => { toast.success("Box moved"); refresh(); })
                            .catch((e) => toast.error((e as Error).message));
                        setDrawFor(null);
                      }
                    : undefined
                }
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{photo.width} × {photo.height}</span>
                {photo.quality && photo.quality !== "ok" ? <Badge variant="outline">Photo: {photo.quality.replace("_", " ")}</Badge> : null}
                {photo.state === "analysing" || photo.state === "waiting" ? <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Analysing</span> : null}
                {r.canReview ? (
                  drawFor ? (
                    <Button size="sm" variant="outline" onClick={() => setDrawFor(null)}>Cancel drawing</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setDrawFor("new")}><Square className="size-3" /> Mark something the AI missed</Button>
                  )
                ) : null}
                {drawFor ? <span>Drag on the photo to draw the box.</span> : null}
              </div>
            </div>
          ) : (
            <p className="rounded border p-6 text-sm text-muted-foreground">No photos yet. Add photos to an area below, or take them with the KNU Field app.</p>
          )}
          {d.areas.length ? null : <AddArea id={d.id} onDone={refresh} canAdd={r.canAddPhotos} />}
          {d.areas.map((a) => (
            <AreaBlock key={a.id} d={d} area={a} selected={photo?.id ?? null} onPick={setPhotoId} onDone={refresh} />
          ))}
          {d.areas.length ? <AddArea id={d.id} onDone={refresh} canAdd={r.canAddPhotos} /> : null}
          <Scope d={d} onDone={refresh} />
        </div>

        <div className="min-w-0 space-y-2">
          <h2 className="text-sm font-semibold">Findings {d.findings.length ? `(${d.findings.length})` : ""}</h2>
          {d.findings.length === 0 ? <p className="text-sm text-muted-foreground">{d.pendingAnalyses ? "The AI is looking at the photos…" : "Nothing found yet."}</p> : null}
          {d.findings.map((f) => (
            <FindingCard
              key={f.id}
              f={f}
              n={numbers.get(f.id)!}
              area={d.areas.find((a) => a.id === f.areaId)?.name ?? null}
              active={f.id === activeFinding}
              canReview={r.canReview}
              onOpen={() => { setActiveFinding(f.id); if (f.photoId) setPhotoId(f.photoId); }}
              onRedraw={() => { setActiveFinding(f.id); if (f.photoId) { setPhotoId(f.photoId); setDrawFor(f.id); } }}
              onDone={refresh}
            />
          ))}
        </div>
      </div>
      {newBox && photo ? <NewFindingDialog inspectionId={d.id} photo={photo} box={newBox} onClose={() => setNewBox(null)} onDone={refresh} /> : null}
    </div>
  );
}

function Actions({ d, unpunched, onDone }: { d: InspectionView; unpunched: number; onDone: () => void }) {
  const [accepting, setAccepting] = useState(false);
  const confirmAction = useConfirm();
  const punch = useMutation({
    mutationFn: () => send(`/api/quality-inspections/${d.id}/punch`, "POST", {}) as Promise<{ created: number; skipped: number }>,
    onSuccess: (res) => { toast.success(`${res.created} punch item${res.created === 1 ? "" : "s"} raised`); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const close = useMutation({
    mutationFn: () => send(`/api/quality-inspections/${d.id}`, "PATCH", { close: true }),
    onSuccess: () => { toast.success("Closed"); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!d.rights.canReview) return null;
  return (
    <>
      {unpunched ? (
        <Button variant="outline" disabled={!d.job || punch.isPending} title={d.job ? undefined : "Attach a job first"} onClick={() => punch.mutate()}>
          <Wrench className="size-4" /> Raise {unpunched} punch item{unpunched === 1 ? "" : "s"}
        </Button>
      ) : null}
      <Button variant="outline" onClick={async () => { if (await confirmAction({ title: "Close this inspection without accepting the work?", confirmLabel: "Close it", tone: "danger" })) close.mutate(); }}>Close</Button>
      <Button disabled={d.blockers.hard.length > 0} onClick={() => setAccepting(true)}>Accept the work</Button>
      {accepting ? <AcceptDialog d={d} onClose={() => setAccepting(false)} onDone={onDone} /> : null}
    </>
  );
}

function AcceptDialog({ d, onClose, onDone }: { d: InspectionView; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const needs = d.blockers.overridable.length > 0;
  const accept = useMutation({
    mutationFn: () => send(`/api/quality-inspections/${d.id}/accept`, "POST", { override: needs ? reason : null }),
    onSuccess: () => { toast.success("Accepted"); onClose(); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Accept the work</DialogTitle></DialogHeader>
        {needs ? (
          d.rights.canOverride ? (
            <div className="space-y-2 text-sm">
              <p>These are still open:</p>
              <ul className="list-disc pl-5">{d.blockers.overridable.map((b) => <li key={b}>{b}</li>)}</ul>
              <p>Accept anyway? Say why — it is kept with the inspection.</p>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
            </div>
          ) : (
            <p className="text-sm">There are open items ({d.blockers.overridable.join(" ")}). Fix them, or ask an admin or manager to accept with a reason.</p>
          )
        ) : (
          <p className="text-sm">Every finding is reviewed and fixed. Accepting records that the work was looked at and accepted from these photos.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={accept.isPending || (needs && (!d.rights.canOverride || !reason.trim()))} onClick={() => accept.mutate()}>Accept</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachJob({ id, onDone }: { id: string; onDone: () => void }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const attach = useMutation({
    mutationFn: () => send(`/api/quality-inspections/${id}`, "PATCH", { jobId }),
    onSuccess: () => { toast.success("Attached to the job"); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border p-3 text-sm">
      <span>No job yet. Punch items need one.</span>
      <div className="w-72"><JobPicker value={jobId} onChange={(j) => setJobId(j?.id ?? null)} placeholder="Choose a job" /></div>
      <Button size="sm" disabled={!jobId || attach.isPending} onClick={() => attach.mutate()}>Attach</Button>
    </div>
  );
}

function AreaBlock({ d, area, selected, onPick, onDone }: { d: InspectionView; area: InspectionView["areas"][number]; selected: string | null; onPick: (id: string) => void; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const photos = d.photos.filter((p) => p.areaId === area.id);
  const failed = d.failedAnalyses.filter((a) => a.areaId === area.id);
  const upload = async (files: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    setUploading(list.length);
    for (const file of list) {
      try {
        const form = await uploadForm(file, { qualityInspectionId: d.id, qualityAreaId: area.id });
        const res = await fetch("/api/files", { method: "POST", body: form, headers: { "idempotency-key": crypto.randomUUID() } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Upload failed");
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`);
      }
      setUploading((n) => n - 1);
    }
    onDone();
  };
  const look = useMutation({
    mutationFn: (mode: "closer" | "retry") => send(`/api/quality-inspections/${d.id}/analyze`, "POST", { areaId: area.id, mode }),
    onSuccess: () => { toast.success("Looking again"); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const checked = useMutation({
    mutationFn: () => send(`/api/quality-areas/${area.id}`, "PATCH", { checked: true }),
    onSuccess: onDone,
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <section className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{area.name}</h3>
        {area.tradeLabel ? <span className="text-xs text-muted-foreground">{area.tradeLabel}</span> : null}
        {area.verdict ? <Badge variant={area.verdict === "issues_found" ? "default" : area.verdict === "cannot_tell" ? "destructive" : "secondary"}>{VERDICT_TEXT[area.verdict]}</Badge> : null}
        <div className="ml-auto flex flex-wrap gap-1">
          {d.rights.canAddPhotos ? (
            <>
              <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
              <Button size="sm" variant="outline" disabled={uploading > 0} onClick={() => input.current?.click()}>
                {uploading ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />} {uploading ? `Uploading ${uploading}` : "Add photos"}
              </Button>
            </>
          ) : null}
          {d.rights.canSeeProposed && d.rights.canAddPhotos && photos.length ? (
            <Button size="sm" variant="outline" disabled={look.isPending} onClick={() => look.mutate("closer")} title="The more capable model looks at this area's latest photos">
              <Search className="size-3" /> Closer look
            </Button>
          ) : null}
          {failed.length && d.rights.canAddPhotos ? <Button size="sm" variant="outline" onClick={() => look.mutate("retry")}><RotateCcw className="size-3" /> Try again</Button> : null}
          {d.rights.canReview && area.verdict === "cannot_tell" ? <Button size="sm" variant="outline" onClick={() => checked.mutate()}><Check className="size-3" /> I checked it</Button> : null}
        </div>
      </div>
      {area.summary ? <p className="text-sm text-muted-foreground">{area.summary}</p> : null}
      {area.photosNeeded.length && d.status === "OPEN" ? (
        <div className="rounded bg-tone-warning-soft p-2 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-tone-warning-fg">Take these photos</div>
          <ul className="list-disc pl-5">{area.photosNeeded.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ) : null}
      {failed.map((f) => <p key={f.id} className="text-sm text-destructive">{f.error ?? "These photos could not be analysed."}</p>)}
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <button key={p.id} type="button" onClick={() => onPick(p.id)} className={`relative h-20 w-24 overflow-hidden rounded border ${p.id === selected ? "ring-2 ring-primary" : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="h-full w-full object-cover" />
            {p.state !== "done" ? (
              <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 text-[10px] text-white">{p.state === "failed" ? "Not analysed" : "Analysing…"}</span>
            ) : d.findings.some((f) => f.photoId === p.id && f.review !== "DISMISSED" && !f.resolved) ? (
              <span className="absolute right-1 top-1 size-2.5 rounded-full bg-tone-warning" />
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function AddArea({ id, onDone, canAdd }: { id: string; onDone: () => void; canAdd: boolean }) {
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const add = useMutation({
    mutationFn: () => send(`/api/quality-inspections/${id}/areas`, "POST", { name, trade: trade || null }),
    onSuccess: () => { setName(""); setTrade(""); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!canAdd) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input className="w-48" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a room or area" />
      <select className="rounded border bg-background px-2 py-2 text-sm" value={trade} onChange={(e) => setTrade(e.target.value)}>
        <option value="">Any trade</option>
        {TRADES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <Button size="sm" variant="outline" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>Add</Button>
    </div>
  );
}

function Scope({ d, onDone }: { d: InspectionView; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(d.scopeText ?? "");
  const save = useMutation({
    mutationFn: () => send(`/api/quality-inspections/${d.id}`, "PATCH", { scopeText: text }),
    onSuccess: () => { setEditing(false); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <details className="rounded border p-3 text-sm" open={editing || undefined}>
      <summary className="cursor-pointer font-medium">Scope checked against {d.scopeText ? "" : "(none)"}</summary>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2"><Button size="sm" onClick={() => save.mutate()}>Save</Button><Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button></div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="whitespace-pre-wrap text-muted-foreground">{d.scopeText ?? "No scope given: the AI judges workmanship only."}</p>
          {d.rights.canEdit ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit scope</Button> : null}
        </div>
      )}
    </details>
  );
}

function FindingCard({ f, n, area, active, canReview, onOpen, onRedraw, onDone }: { f: Finding; n: number; area: string | null; active: boolean; canReview: boolean; onOpen: () => void; onRedraw: () => void; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [title, setTitle] = useState(f.title);
  const [action, setAction] = useState(f.action ?? "");
  const [severity, setSeverity] = useState<Severity>(f.severity as Severity);
  const op = useMutation({
    mutationFn: (body: Record<string, unknown>) => send(`/api/quality-findings/${f.id}`, "PATCH", body),
    onSuccess: () => { setEditing(false); setDismissing(false); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const dim = f.review === "DISMISSED" || f.resolved;
  return (
    <div id={`f-${f.id}`} className={`space-y-1.5 rounded border p-3 text-sm ${active ? "ring-2 ring-primary" : ""} ${dim ? "opacity-60" : ""}`} onClick={onOpen}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex size-5 items-center justify-center rounded bg-foreground text-[11px] font-bold text-background">{n}</span>
        <Badge variant={sevVariant(f.severity)}>{SEVERITY_LABEL[f.severity as Severity]}</Badge>
        <Badge variant="outline">{KIND_TEXT[f.kind] ?? f.kind}</Badge>
        {f.review === "PROPOSED" ? <Badge variant="secondary">{f.source === "AI" ? "AI proposed" : "Proposed"}</Badge> : null}
        {f.review === "CONFIRMED" ? <Badge variant="outline">Confirmed{f.edited ? " (edited)" : ""}</Badge> : null}
        {f.review === "DISMISSED" ? <Badge variant="outline">Dismissed · {DISMISS_LABEL[f.dismissReason as DismissReason] ?? f.dismissReason}</Badge> : null}
        {f.resolved ? <Badge variant="outline">Fixed</Badge> : null}
        {f.confidence != null && f.source === "AI" ? <span className="text-xs text-muted-foreground">{Math.round(f.confidence * 100)}% sure</span> : null}
      </div>
      {editing ? (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="What to do to fix it" />
          <select className="rounded border bg-background px-2 py-1" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
          </select>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => op.mutate({ op: "confirm", title, action, severity })}>Confirm with changes</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="font-medium">{area ? <span className="text-muted-foreground">{area}: </span> : null}{f.title}</div>
          <p className="text-muted-foreground">{f.evidence}</p>
          {f.action ? <p><span className="font-medium">Fix:</span> {f.action}</p> : null}
          {f.physicalCheck ? <p><span className="font-medium">Check in person:</span> {f.physicalCheck}</p> : null}
          {!f.boxes.length && f.photoId ? <p className="text-xs text-muted-foreground">Not placed on the photo.</p> : null}
          {f.punch ? <p className="text-xs">Punch item · {f.punch.status.toLowerCase().replace("_", " ")} {f.punch.taskId ? <Link className="underline" href={`/tasks?task=${f.punch.taskId}`} onClick={(e) => e.stopPropagation()}>open task</Link> : null}</p> : null}
        </>
      )}
      {dismissing ? (
        <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
          {DISMISS_REASONS.map((reason) => (
            <Button key={reason} size="sm" variant="outline" onClick={() => op.mutate({ op: "dismiss", dismissReason: reason })}>{DISMISS_LABEL[reason]}</Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setDismissing(false)}>Cancel</Button>
        </div>
      ) : null}
      {canReview && !editing && !dismissing ? (
        <div className="flex flex-wrap gap-1 pt-1" onClick={(e) => e.stopPropagation()}>
          {f.review === "PROPOSED" ? (
            <>
              <Button size="sm" disabled={op.isPending} onClick={() => op.mutate({ op: "confirm" })}><Check className="size-3" /> Confirm</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-3" /> Edit</Button>
              <Button size="sm" variant="outline" onClick={() => setDismissing(true)}><X className="size-3" /> Dismiss</Button>
            </>
          ) : null}
          {f.review === "CONFIRMED" && !f.resolved ? (
            <>
              <Button size="sm" variant="outline" onClick={() => op.mutate({ op: "resolve" })}><Check className="size-3" /> Mark fixed</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-3" /> Edit</Button>
              {!f.punch ? <Button size="sm" variant="ghost" onClick={() => setDismissing(true)}>Dismiss</Button> : null}
            </>
          ) : null}
          {f.review === "CONFIRMED" && f.resolved && !f.punch ? <Button size="sm" variant="ghost" onClick={() => op.mutate({ op: "unresolve" })}>Not fixed</Button> : null}
          {f.review === "DISMISSED" ? <Button size="sm" variant="ghost" onClick={() => op.mutate({ op: "reopen" })}>Reopen</Button> : null}
          {f.photoId && f.review !== "DISMISSED" ? <Button size="sm" variant="ghost" onClick={onRedraw}><Square className="size-3" /> {f.boxes.length ? "Redraw box" : "Draw box"}</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

function NewFindingDialog({ inspectionId, photo, box, onClose, onDone }: { inspectionId: string; photo: Photo; box: Box; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [action, setAction] = useState("");
  const [severity, setSeverity] = useState<Severity>("MINOR");
  const add = useMutation({
    mutationFn: () => send(`/api/quality-inspections/${inspectionId}/findings`, "POST", { photoId: photo.id, title, action: action || null, severity, evidence: "", boxes: [box] }),
    onSuccess: () => { toast.success("Added"); onClose(); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add a finding</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is wrong (e.g. Outlet cover missing)" />
          <Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="What to do to fix it" />
          <select className="rounded border bg-background px-2 py-1" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
          </select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!title.trim() || add.isPending} onClick={() => add.mutate()}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
