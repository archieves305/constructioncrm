"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/shared/callout";
import { HttpError } from "@/lib/fetch-json";
import type { Pt } from "@/lib/takeoff/geometry";
import type { Verification } from "@/lib/takeoff/geometry/calibrate";
import { formatFeetInches, parseFeetInches } from "@/lib/takeoff/geometry/dimensions";
import { errorText, type Sheet } from "../use-plan-sets";
import { useCalibrate, type CalibrateResult } from "../use-takeoff";

/**
 * Calibrating a sheet. Auto: the printed scale checked against the drawn
 * dimensions, shown with its verdict for the person to accept. Manual: the
 * two points just clicked and the distance between them, typed as `20'-0"`.
 */
export function CalibrateDialog({ sheet, planSetId, mode, points, open, onOpenChange, onDone }: { sheet: Sheet; planSetId: string; mode: "auto" | "manual"; points?: [Pt, Pt]; open: boolean; onOpenChange: (v: boolean) => void; onDone?: (r: CalibrateResult) => void }) {
  const calibrate = useCalibrate(planSetId);
  const [distance, setDistance] = useState("");
  const [proposal, setProposal] = useState<CalibrateResult | null>(null);
  const [failure, setFailure] = useState<{ message: string; verification: Verification | null } | null>(null);
  const feet = parseFeetInches(distance);
  const pointsPt = points ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : 0;

  useEffect(() => {
    if (!open) { setProposal(null); setFailure(null); setDistance(""); return; }
    if (mode === "auto") {
      calibrate.mutate({ sheetId: sheet.id, input: { mode: "auto" } }, {
        onSuccess: (r) => setProposal(r),
        onError: (err) => setFailure({ message: errorText(err), verification: err instanceof HttpError ? ((err.body as { verification?: Verification | null })?.verification ?? null) : null }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, sheet.id]);

  function saveManual() {
    if (!points || !feet) return;
    calibrate.mutate({ sheetId: sheet.id, input: { mode: "manual", a: points[0], b: points[1], distanceFt: feet } }, {
      onSuccess: (r) => { toast.success(`Calibrated: ${r.sheet.ptPerFt} pt per foot`); onDone?.(r); onOpenChange(false); },
      onError: (err) => toast.error(errorText(err)),
    });
  }

  const v = proposal?.verification ?? failure?.verification ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "auto" ? "Check the printed scale" : "Calibrate from a dimension"}</DialogTitle>
          <DialogDescription>{sheet.sheetNumber ?? `Page ${sheet.pageNumber}`}{sheet.title ? ` · ${sheet.title}` : ""}</DialogDescription>
        </DialogHeader>
        {mode === "auto" && (
          <div className="space-y-3 text-sm">
            {calibrate.isPending && !proposal && !failure && <p className="text-muted-foreground">Reading the dimension strings and their lines…</p>}
            {failure && <Callout tone="warning" title="Could not verify">{failure.message}</Callout>}
            {proposal && (
              <Callout tone={proposal.sheet.scaleSource === "AUTO_VERIFIED" ? "success" : "warning"} title={proposal.sheet.scaleSource === "AUTO_VERIFIED" ? "Verified" : "Printed scale only"}>
                {proposal.sheet.scaleText ?? "No printed scale"} → {proposal.sheet.ptPerFt} pt per foot
                {proposal.affectedMeasurements > 0 && <span className="block text-xs">{proposal.affectedMeasurements} measurement{proposal.affectedMeasurements === 1 ? "" : "s"} on this sheet keep their values until you choose Recompute.</span>}
              </Callout>
            )}
            {v && (
              <div className="rounded-md border p-2 text-xs text-muted-foreground" data-testid="verification">
                <p>{v.matches.length} dimension{v.matches.length === 1 ? "" : "s"} matched to drawn lines{v.dropped ? ` (${v.dropped} ignored as mis-matches)` : ""}.</p>
                {v.medianPtPerFt && <p>They agree on {v.medianPtPerFt} pt per foot{v.printedPtPerFt ? `, ${Math.abs((v.deviation ?? 0) * 100).toFixed(1)} % ${(v.deviation ?? 0) >= 0 ? "over" : "under"} the printed ${v.printedPtPerFt}` : ""}; spread {((v.spread ?? 0) * 100).toFixed(1)} %.</p>}
                {v.matches.slice(0, 6).map((m) => <p key={m.itemId}>{m.text} → {m.lengthPt.toFixed(0)} pt ({m.ptPerFt.toFixed(2)} pt/ft)</p>)}
              </div>
            )}
          </div>
        )}
        {mode === "manual" && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">The two points are {pointsPt.toFixed(1)} pt apart. What is the dimension between them?</p>
            <div className="space-y-1">
              <Label htmlFor="cal-distance">Distance</Label>
              <Input id="cal-distance" autoFocus placeholder={`20'-0"`} value={distance} onChange={(e) => setDistance(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveManual(); }} />
              {feet ? <p className="text-xs text-muted-foreground">{formatFeetInches(feet)} → {(pointsPt / feet).toFixed(2)} pt per foot{sheet.ptPerFt ? ` (now ${sheet.ptPerFt})` : ""}</p> : distance ? <p className="text-xs text-tone-danger-fg">Type feet and inches, like 20&apos;-6&quot;</p> : null}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {mode === "manual" && <Button disabled={!feet || calibrate.isPending} onClick={saveManual}>Save calibration</Button>}
          {mode === "auto" && proposal && <Button onClick={() => { onDone?.(proposal); onOpenChange(false); }}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
