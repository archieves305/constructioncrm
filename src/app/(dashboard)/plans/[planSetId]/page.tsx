"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useIsPhone } from "@/components/shared/use-media-query";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { CalibrationBadge, TextBadge } from "@/components/takeoff/badges";
import { SheetIndexTable } from "@/components/takeoff/sheet-index-table";
import { PlanViewer } from "@/components/takeoff/viewer/plan-viewer";
import { errorText, usePlanSet, useSheets } from "@/components/takeoff/use-plan-sets";
import { useSession } from "@/lib/auth/session-client";
import { canEditTakeoff } from "@/lib/takeoff/access";
import { DISCIPLINE_LABEL } from "@/lib/takeoff/types";
import { cn } from "@/lib/utils";

/**
 * The plan-set viewer: every sheet in a rail on the left, the sheet itself in
 * the middle, its index and calibration on the right. The sheet is in the URL
 * (`?sheet=`) so a link lands on it. Drawing tools arrive with M2.
 */
export default function PlanSetPage({ params }: { params: Promise<{ planSetId: string }> }) {
  const { planSetId } = use(params);
  const { get: getUrl, set: setUrl } = useSearchParamState();
  const { data: session } = useSession();
  const canEdit = canEditTakeoff(session?.user.role);
  const phone = useIsPhone();
  const set = usePlanSet(planSetId);
  const sheets = useSheets(planSetId);

  const sheetId = getUrl("sheet");
  const list = useMemo(() => sheets.data ?? [], [sheets.data]);
  const current = list.find((s) => s.id === sheetId) ?? list[0] ?? null;
  const index = current ? list.findIndex((s) => s.id === current.id) : -1;
  const go = (i: number) => { const s = list[i]; if (s) setUrl("sheet", s.id); };

  if (set.isLoading || sheets.isLoading) return <div className="p-6"><ListSkeleton rows={4} /></div>;
  if (set.isError || sheets.isError) return <div className="p-6"><Callout tone="danger" title="Couldn't load the plan set">{errorText(set.error ?? sheets.error)}</Callout></div>;
  if (!set.data) return <EmptyState title="This plan set no longer exists" action={<Link href="/leads" className={buttonVariants({ variant: "outline" })}>Back to leads</Link>} />;

  const back = set.data.job ? `/jobs/${set.data.job.id}?tab=money&sub=takeoff` : `/leads/${set.data.leadId}?tab=takeoff`;
  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <Link href={back} className={buttonVariants({ variant: "ghost", size: "sm" })}>‹ Back</Link>
      <h1 className="text-sm font-semibold">{set.data.name}</h1>
      <span className="text-sm text-muted-foreground">· {list.length} sheets</span>
      {current && (
        <div className="ml-auto flex items-center gap-1 text-sm">
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Previous sheet" disabled={index <= 0} onClick={() => go(index - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-28 text-center font-mono">{current.sheetNumber ?? `p.${current.pageNumber}`}</span>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Next sheet" disabled={index >= list.length - 1} onClick={() => go(index + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}
    </div>
  );

  if (!list.length) return <div>{header}<EmptyState title="No sheets yet" description="The set is still being read, or nothing was uploaded." /></div>;

  if (phone) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] flex-col">
        {header}
        <div className="min-h-0 flex-1"><PlanViewer sheet={current} /></div>
        <div className="border-t px-4 py-2 text-sm"><p className="font-medium">{current?.title ?? "Untitled"}</p><p className="text-xs text-muted-foreground">Edit the sheet index on a desktop.</p></div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      {header}
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_320px]">
        <aside className="min-h-0 overflow-y-auto border-r" data-testid="sheet-rail">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setUrl("sheet", s.id)}
              className={cn("flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted", current?.id === s.id && "bg-muted font-medium")}
            >
              <span className="w-12 shrink-0 font-mono text-xs">{s.sheetNumber ?? `p.${s.pageNumber}`}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.title ?? "Untitled"}</span>
            </button>
          ))}
        </aside>
        <main className="min-h-0"><PlanViewer sheet={current} /></main>
        <aside className="min-h-0 overflow-y-auto border-l p-3 text-sm" data-testid="sheet-details">
          {current && (
            <div className="space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Sheet</p>
                <p className="font-mono text-base">{current.sheetNumber ?? "—"}</p>
                <p>{current.title ?? <span className="italic text-muted-foreground">Untitled</span>}</p>
                <p className="text-xs text-muted-foreground">{DISCIPLINE_LABEL[current.discipline]} · page {current.pageNumber} · {Math.round(current.widthPt / 72)}×{Math.round(current.heightPt / 72)} in</p>
              </div>
              <div className="flex flex-wrap gap-1"><CalibrationBadge source={current.scaleSource} isRaster={current.isRaster} /><TextBadge isRaster={current.isRaster} /></div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Scale</p>
                <p>{current.scaleText ?? <span className="italic text-muted-foreground">None found</span>}{current.ptPerFt ? <span className="text-muted-foreground"> · {current.ptPerFt} pt/ft</span> : null}</p>
                {current.detected?.otherScales?.length ? <p className="text-xs text-muted-foreground">Also on this sheet: {current.detected.otherScales.join(", ")}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">Calibration against the drawn dimensions comes with the measuring tools.</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Index</p>
                <SheetIndexTable planSetId={planSetId} sheets={[current]} canEdit={canEdit} compact currentSheetId={current.id} />
                {current.corrected && current.detected && (
                  <p className="mt-1 text-xs text-muted-foreground">Detected: {current.detected.sheetNumber ?? "—"} · {current.detected.title ?? "—"} · {DISCIPLINE_LABEL[current.detected.discipline]}</p>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
