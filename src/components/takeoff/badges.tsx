"use client";

import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/lib/ui/tones";
import type { PlanDocumentStatusName, PlanJobStatusName, SheetScaleSourceName } from "@/lib/takeoff/types";

function Pill({ tone, children, className, title }: { tone: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", toneClasses(tone).pill, className)}>{children}</span>;
}

export function CalibrationBadge({ source, isRaster }: { source: SheetScaleSourceName; isRaster: boolean }) {
  if (source === "MANUAL") return <Pill tone="success">Calibrated by hand</Pill>;
  if (source === "AUTO_VERIFIED") return <Pill tone="success">Calibrated</Pill>;
  if (source === "AUTO") return <Pill tone="info" title="The printed scale; not yet checked against the drawn dimensions">Printed scale</Pill>;
  if (isRaster) return <Pill tone="warning" title="Scanned sheet: no readable text">Needs calibration</Pill>;
  return <Pill tone="warning">Needs calibration</Pill>;
}

export function DocumentStatusBadge({ status }: { status: PlanDocumentStatusName }) {
  const map: Record<PlanDocumentStatusName, { tone: Tone; label: string }> = {
    UPLOADED: { tone: "neutral", label: "Uploaded" },
    INDEXING: { tone: "info", label: "Reading" },
    INDEXED: { tone: "success", label: "Indexed" },
    FAILED: { tone: "danger", label: "Failed" },
  };
  return <Pill tone={map[status].tone}>{map[status].label}</Pill>;
}

export function JobStatusBadge({ status }: { status: PlanJobStatusName }) {
  const map: Record<PlanJobStatusName, { tone: Tone; label: string }> = {
    PENDING: { tone: "neutral", label: "Queued" },
    RUNNING: { tone: "info", label: "Running" },
    DONE: { tone: "success", label: "Done" },
    FAILED: { tone: "danger", label: "Failed" },
    CANCELLED: { tone: "neutral", label: "Cancelled" },
  };
  return <Pill tone={map[status].tone}>{map[status].label}</Pill>;
}

export function TextBadge({ isRaster }: { isRaster: boolean }) {
  return isRaster ? <Pill tone="warning" title="No readable text or drawn lines: nothing automatic runs on this sheet">Scanned</Pill> : <Pill tone="neutral">Vector</Pill>;
}

export function ConfidencePill({ value }: { value: number | null }) {
  if (value == null) return <Pill tone="neutral">—</Pill>;
  const tone: Tone = value >= 0.9 ? "success" : value >= 0.6 ? "info" : "warning";
  return <Pill tone={tone} title="How sure the index is">{Math.round(value * 100)}%</Pill>;
}
