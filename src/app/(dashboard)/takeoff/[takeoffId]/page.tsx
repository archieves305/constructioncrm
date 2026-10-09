"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useIsPhone } from "@/components/shared/use-media-query";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { CalibrationBadge } from "@/components/takeoff/badges";
import { MeasurementInspector, MeasurementList } from "@/components/takeoff/measurements/measurement-list";
import { errorText, useSheets, type Sheet } from "@/components/takeoff/use-plan-sets";
import { useCalibrate, useCreateMeasurement, useDeleteMeasurement, useMeasurements, useRecompute, useSheetSnapIndex, useTakeoff, useUpdateMeasurement } from "@/components/takeoff/use-takeoff";
import { CalibrateDialog } from "@/components/takeoff/viewer/calibrate-dialog";
import { DrawToolbar } from "@/components/takeoff/viewer/draw-toolbar";
import { LabelPopover, type LabelChoice } from "@/components/takeoff/viewer/label-popover";
import { PlanViewer, type ViewState } from "@/components/takeoff/viewer/plan-viewer";
import { DraftShape, MeasurementShape } from "@/components/takeoff/viewer/shapes";
import { TOOL_KIND, useDrawing, type Tool } from "@/components/takeoff/viewer/use-drawing";
import { useSession } from "@/lib/auth/session-client";
import { canApproveTakeoff, canEditTakeoff } from "@/lib/takeoff/access";
import type { Pt } from "@/lib/takeoff/geometry";
import { computeValue } from "@/lib/takeoff/measurement-value";
import { TRADE_LABEL, UNIT_FOR_KIND, type MeasurementKindName } from "@/lib/takeoff/metrics";
import { cn } from "@/lib/utils";

type Pending = { kind: MeasurementKindName; points: Pt[] };

/**
 * The takeoff workspace: the takeoff's sheets in a rail, the sheet under the
 * drawing tools, the measurements and the calibration beside it. The sheet
 * and the selected measurement live in the URL. Materials and the RFQ tabs
 * arrive with M5 and M6.
 */
export default function TakeoffPage({ params }: { params: Promise<{ takeoffId: string }> }) {
  const { takeoffId } = use(params);
  const { get: getUrl, set: setUrl } = useSearchParamState();
  const { data: session } = useSession();
  const canEdit = canEditTakeoff(session?.user.role);
  const canApprove = canApproveTakeoff(session?.user.role);
  const phone = useIsPhone();

  const takeoff = useTakeoff(takeoffId);
  const planSetId = takeoff.data?.planSet.id ?? null;
  const sheets = useSheets(planSetId);
  const measurements = useMeasurements(takeoffId);
  const create = useCreateMeasurement(takeoffId);
  const update = useUpdateMeasurement(takeoffId);
  const remove = useDeleteMeasurement(takeoffId);
  const recompute = useRecompute(takeoffId);
  const calibrate = useCalibrate(planSetId ?? "");

  const [tool, setTool] = useState<Tool>("select");
  const [snapOn, setSnapOn] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ s: 1, tx: 0, ty: 0 });
  const [pending, setPending] = useState<Pending | null>(null);
  const [calibrateMode, setCalibrateMode] = useState<{ mode: "auto" | "manual"; points?: [Pt, Pt] } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; points: Pt[] } | null>(null);

  const selectedSheetIds = useMemo(() => new Set(takeoff.data?.sheets.map((s) => s.planSheetId) ?? []), [takeoff.data]);
  const allSheets = useMemo(() => sheets.data ?? [], [sheets.data]);
  const railSheets = useMemo(() => (showAll ? allSheets : allSheets.filter((s) => selectedSheetIds.has(s.id))), [allSheets, selectedSheetIds, showAll]);
  const sheetId = getUrl("sheet");
  const current: Sheet | null = allSheets.find((s) => s.id === sheetId) ?? railSheets[0] ?? allSheets[0] ?? null;
  const selectedId = getUrl("m");
  const selected = measurements.data?.find((m) => m.id === selectedId) ?? null;
  const rows = useMemo(() => measurements.data ?? [], [measurements.data]);
  const onSheet = useMemo(() => rows.filter((m) => m.planSheetId === current?.id), [rows, current?.id]);
  const countBySheet = useMemo(() => { const c = new Map<string, number>(); for (const m of rows) c.set(m.planSheetId, (c.get(m.planSheetId) ?? 0) + 1); return c; }, [rows]);
  const index = current ? railSheets.findIndex((s) => s.id === current.id) : -1;

  const snap = useSheetSnapIndex(current?.id ?? null, tool !== "select");
  const trade = takeoff.data?.trade ?? "ROOFING";
  const uncalibrated = !!current && !current.ptPerFt;

  const onCommit = useCallback((t: Tool, points: Pt[]) => {
    if (t === "calibrate") { setCalibrateMode({ mode: "manual", points: [points[0], points[1]] }); return; }
    const kind = TOOL_KIND[t as keyof typeof TOOL_KIND];
    if (kind !== "COUNT" && uncalibrated) { toast.error("Calibrate this sheet before measuring lengths or areas"); return; }
    setPending({ kind, points });
  }, [uncalibrated]);

  const drawing = useDrawing({ tool, snapIndex: snap.index, snapOn: snapOn && snap.available, scale: view.s, ptPerFt: current?.ptPerFt ?? null, onCommit });

  const viewerOptions = useMemo(() => ({
    onTap: (p: Pt) => { if (tool === "select") setUrl("m", null); else if (!pending) drawing.onTap(p); },
    onHover: drawing.onHover,
    onDoubleTap: () => drawing.onDoubleTap(),
  }), [tool, pending, drawing, setUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (pending || calibrateMode) return;
      const k = e.key.toLowerCase();
      if (!canEdit && k !== "v") return;
      if (k === "v") setTool("select"); else if (k === "a") setTool("area"); else if (k === "l") setTool("linear"); else if (k === "c") setTool("count"); else if (k === "k") setTool("calibrate");
      else if (k === "s") setSnapOn((v) => !v);
      else if ((e.key === "Delete" || e.key === "Backspace") && tool === "select" && selected && canEdit) { e.preventDefault(); remove.mutate(selected.id, { onSuccess: () => setUrl("m", null) }); }
      else if (e.key === "PageDown" && index < railSheets.length - 1) setUrl("sheet", railSheets[index + 1].id);
      else if (e.key === "PageUp" && index > 0) setUrl("sheet", railSheets[index - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, calibrateMode, canEdit, tool, selected, remove, setUrl, index, railSheets]);

  function savePending(choice: LabelChoice) {
    if (!pending || !current) return;
    create.mutate({ planSheetId: current.id, kind: pending.kind, metricKey: choice.metricKey, label: choice.label, attributes: choice.attributes, geometry: { points: pending.points } }, {
      onSuccess: (m) => { setPending(null); setUrl("m", m.id); toast.success(`${m.label}: ${m.valueRaw.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${m.unit}`); },
    });
  }

  const pendingValue = pending && current ? computeValue(pending.kind, { points: pending.points }, current.ptPerFt) : null;

  if (takeoff.isLoading || sheets.isLoading) return <div className="p-6"><ListSkeleton rows={4} /></div>;
  if (takeoff.isError) return <div className="p-6"><Callout tone="danger" title="Couldn't load the takeoff">{errorText(takeoff.error)}</Callout></div>;
  if (!takeoff.data) return <EmptyState title="This takeoff no longer exists" action={<Link href="/leads" className={buttonVariants({ variant: "outline" })}>Back to leads</Link>} />;
  const t = takeoff.data;
  const back = t.job ? `/jobs/${t.job.id}?tab=money&sub=takeoff` : `/leads/${t.leadId}?tab=takeoff`;

  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <Link href={back} className={buttonVariants({ variant: "ghost", size: "sm" })}>‹ Back</Link>
      <h1 className="text-sm font-semibold">{TRADE_LABEL[t.trade]} takeoff <span className="font-mono text-muted-foreground">{t.number}</span></h1>
      <span className="text-xs text-muted-foreground">· {t.measurementCount} measurement{t.measurementCount === 1 ? "" : "s"}</span>
      {t.stale && <span className="rounded-full bg-tone-warning-soft px-2 py-0.5 text-xs text-tone-warning-fg">Plan set has newer documents</span>}
      {current && (
        <div className="ml-auto flex items-center gap-1 text-sm">
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Previous sheet" disabled={index <= 0} onClick={() => setUrl("sheet", railSheets[index - 1].id)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-24 text-center font-mono">{current.sheetNumber ?? `p.${current.pageNumber}`}</span>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Next sheet" disabled={index < 0 || index >= railSheets.length - 1} onClick={() => setUrl("sheet", railSheets[index + 1].id)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}
    </div>
  );

  const overlay = (v: ViewState) => (
    <>
      {rows.filter((m) => m.planSheetId === current?.id).map((m) => (
        <MeasurementShape key={m.id} m={dragging?.id === m.id ? { ...m, geometry: { points: dragging.points } } : m} scale={v.s} selected={selectedId === m.id} hovered={hoverId === m.id} dimmed={!!selectedId && selectedId !== m.id && tool === "select"} editable={canEdit && tool === "select"}
          onSelect={(id) => setUrl("m", id)} onHover={setHoverId}
          onVertexDrag={(id, i, p) => setDragging((d) => { const base = d?.id === id ? d.points : m.geometry.points; const pts = base.map((q, j) => (j === i ? p : q)); return { id, points: pts }; })}
          onVertexDragEnd={(id) => { if (dragging?.id === id) { update.mutate({ id, patch: { geometry: { points: dragging.points } } }); setDragging(null); } }}
        />
      ))}
      {pending && <DraftShape points={pending.points} cursor={null} snap={null} kind={pending.kind === "AREA" ? "area" : pending.kind === "LENGTH" ? "linear" : "count"} scale={v.s} />}
      {!pending && tool !== "select" && <DraftShape points={drawing.draft.points} cursor={drawing.draft.cursor} snap={drawing.draft.snap} kind={tool as "area" | "linear" | "count" | "calibrate"} scale={v.s} />}
    </>
  );

  const viewer = (
    <div className="relative h-full w-full">
      <PlanViewer sheet={current} overlay={overlay} options={viewerOptions} cursor={tool === "select" ? undefined : "crosshair"} onViewChange={setView} />
      {!phone && canEdit && <DrawToolbar tool={tool} onTool={setTool} snap={snapOn} onSnap={setSnapOn} snapAvailable={snap.available} disabledReason={null} />}
      {drawing.readout && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-background/95 px-3 py-1 text-sm font-medium shadow" data-testid="readout">{drawing.readout}</div>}
      {tool !== "select" && !drawing.readout && !pending && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-background/90 px-3 py-1 text-xs text-muted-foreground">{tool === "count" ? "Click each item" : tool === "calibrate" ? "Click both ends of a known dimension" : "Click the corners · Enter or double-click to finish · Esc to cancel"}</div>}
      {pending && current && (
        <div className="absolute left-1/2 top-12 -translate-x-1/2">
          <LabelPopover trade={trade} kind={pending.kind} value={pendingValue?.valueRaw ?? null} unit={pendingValue?.unit ?? UNIT_FOR_KIND[pending.kind]} onSave={savePending} onCancel={() => setPending(null)} />
        </div>
      )}
    </div>
  );

  if (phone) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] flex-col">
        {header}
        <div className="min-h-0 flex-1">{viewer}</div>
        <div className="max-h-[40%] overflow-y-auto border-t"><MeasurementList measurements={rows} trade={trade} selectedId={selectedId} onSelect={(id) => setUrl("m", id)} onHover={setHoverId} sheetFilter={current?.id ?? null} /></div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      {header}
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_360px]">
        <aside className="flex min-h-0 flex-col border-r" data-testid="sheet-rail">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
            <span>{showAll ? "All sheets" : "In this takeoff"}</span>
            <button type="button" className="text-primary hover:underline" onClick={() => setShowAll((v) => !v)}>{showAll ? "Takeoff only" : "All sheets"}</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {railSheets.map((s) => (
              <button key={s.id} type="button" onClick={() => setUrl("sheet", s.id)} className={cn("flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted", current?.id === s.id && "bg-muted font-medium")}>
                <span className="w-12 shrink-0 font-mono text-xs">{s.sheetNumber ?? `p.${s.pageNumber}`}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.title ?? "Untitled"}</span>
                {countBySheet.get(s.id) ? <span className="rounded-full bg-primary/10 px-1.5 text-xs">{countBySheet.get(s.id)}</span> : null}
              </button>
            ))}
            {!railSheets.length && <p className="p-3 text-xs text-muted-foreground">No sheets selected for this takeoff.</p>}
          </div>
        </aside>
        <main className="min-h-0">{viewer}</main>
        <aside className="flex min-h-0 flex-col border-l" data-testid="takeoff-side">
          {current && (
            <div className="space-y-2 border-b p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{current.sheetNumber ?? `p.${current.pageNumber}`}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{current.title}</span>
                <CalibrationBadge source={current.scaleSource} isRaster={current.isRaster} />
              </div>
              <p className="text-xs text-muted-foreground">{current.scaleText ?? "No printed scale"}{current.ptPerFt ? ` · ${current.ptPerFt} pt/ft` : ""}{current.scaleConfidence != null ? ` · ${Math.round(current.scaleConfidence * 100)}%` : ""}</p>
              {canEdit && (
                <div className="flex flex-wrap gap-1">
                  {!current.isRaster && <Button size="sm" variant="outline" onClick={() => setCalibrateMode({ mode: "auto" })}>Auto calibrate</Button>}
                  {current.scaleSource === "AUTO" && <Button size="sm" variant="outline" onClick={() => calibrate.mutate({ sheetId: current.id, input: { mode: "confirm" } }, { onSuccess: () => toast.success("Printed scale confirmed"), onError: (e) => toast.error(errorText(e)) })}>Confirm printed scale</Button>}
                  <Button size="sm" variant={tool === "calibrate" ? "default" : "outline"} onClick={() => setTool(tool === "calibrate" ? "select" : "calibrate")}>Calibrate by hand</Button>
                  {onSheet.some((m) => m.kind !== "COUNT" && m.ptPerFt !== current.ptPerFt) && <Button size="sm" variant="outline" onClick={() => recompute.mutate()}><RefreshCw className="mr-1 h-3 w-3" /> Recompute</Button>}
                </div>
              )}
              {uncalibrated && <Callout tone="warning" title="Needs calibration">Lengths and areas wait until this sheet is calibrated; counts work now.</Callout>}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MeasurementList measurements={rows} trade={trade} selectedId={selectedId} onSelect={(id) => setUrl("m", id)} onHover={setHoverId} sheetFilter={current?.id ?? null} />
          </div>
          {selected && (
            <MeasurementInspector key={selected.id} m={selected} trade={trade} canEdit={canEdit} canApprove={canApprove}
              onPatch={(patch) => update.mutate({ id: selected.id, patch })}
              onDelete={() => remove.mutate(selected.id, { onSuccess: () => setUrl("m", null) })}
              onClose={() => setUrl("m", null)} />
          )}
        </aside>
      </div>
      {current && calibrateMode && (
        <CalibrateDialog sheet={current} planSetId={planSetId ?? ""} mode={calibrateMode.mode} points={calibrateMode.points} open onOpenChange={(v) => { if (!v) { setCalibrateMode(null); setTool("select"); } }} />
      )}
    </div>
  );
}
