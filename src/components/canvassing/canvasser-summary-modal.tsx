"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarPlus,
  Copy,
  DoorOpen,
  Phone,
  RefreshCw,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  KnockScoreBadgeLarge,
  type Priority,
} from "@/components/canvassing/knock-score-badge";

// Shape returned by GET /api/canvassing/properties/[reapiId].
type Summary = {
  knockScore: number;
  tier: string;
  priority: Priority;
  reasons: string[];
  recommendedOpening: string;
  phoneScript: string;
  talkingPoints: string[];
  financingAngle: string | null;
  insuranceAngle: string | null;
  cautionNotes: string[];
  disclaimer: string;
  isAbsentee: boolean;
};

type Detail = {
  reapiId: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ownerName: string | null;
  ownerOccupied: boolean | null;
  yearBuilt: number | null;
  ownedSince: number | null;
  estimatedValue: number | null;
  estimatedEquity: number | null;
  equityPercentage: number | null;
  roofType: string | null;
  estimatedRoofAge: number | null;
  roofAgeBasis: "permit" | "yearBuilt" | "unknown";
  lastSaleDate: string | null;
  lastRoofPermitDate: string | null;
  knockScore: number;
  knockScoreTier: string | null;
  summary: Summary;
  stale: boolean;
};

export type SummaryActions = {
  saveLabel?: string;
  onSaveAsLead?: () => void;
  onMarkKnocked?: () => void;
  onSchedule?: () => void;
};

const money = (n: number | null | undefined) =>
  n == null ? "Unknown" : `$${Math.round(n).toLocaleString("en-US")}`;

function roofAgeLabel(d: Detail): string {
  if (d.estimatedRoofAge == null) return "Unknown";
  if (d.roofAgeBasis === "permit") return `${d.estimatedRoofAge} years`;
  return `Approx. ${d.estimatedRoofAge} years (from year built)`;
}

function equityLabel(d: Detail): string {
  if (d.estimatedEquity == null) return "Unknown";
  const pct = d.equityPercentage != null ? ` / ${d.equityPercentage}%` : "";
  return `${money(d.estimatedEquity)}${pct}`;
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Couldn't copy — select and copy manually");
  }
}

function CopyBlock({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => copy(text, title)}
      className="group w-full rounded-md border bg-gray-50 p-3 text-left active:bg-gray-100"
    >
      <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        <span className="flex items-center gap-1 opacity-60 group-hover:opacity-100">
          <Copy className="h-3 w-3" /> Tap to copy
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-snug">{text}</p>
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export function CanvasserSummaryModal({
  reapiId,
  open,
  onOpenChange,
  actions,
}: {
  reapiId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  actions?: SummaryActions;
}) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<Detail>({
    queryKey: ["canvassing-summary", reapiId],
    queryFn: async () => {
      const res = await fetch(`/api/canvassing/properties/${reapiId}`);
      if (res.status === 503) throw new Error("Property data is not configured");
      if (res.status === 402) throw new Error("Property-data credit limit reached");
      if (!res.ok) throw new Error("Property data unavailable");
      return res.json();
    },
    enabled: open && !!reapiId,
  });

  const s = data?.summary;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md gap-0 overflow-y-auto p-0">
        <DialogHeader className="sticky top-0 z-10 border-b bg-white px-4 py-3">
          <DialogTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Canvasser Summary
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-4 py-4">
          {isLoading && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Loading property insights…
            </p>
          )}

          {isError && (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-red-600">
                Property data unavailable. Try refresh.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            </div>
          )}

          {data && s && (
            <>
              {/* Address + owner */}
              <div>
                <h3 className="text-base font-semibold leading-tight">
                  {data.address ?? "Property"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {[data.city, data.state, data.zip].filter(Boolean).join(", ")}
                </p>
                <p className="mt-1 text-sm">
                  <span className="text-muted-foreground">Owner: </span>
                  {data.ownerName ?? "Unknown"}
                  {data.ownerOccupied === false && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                      Absentee
                    </span>
                  )}
                </p>
              </div>

              {/* Big score */}
              <KnockScoreBadgeLarge
                score={data.knockScore}
                tier={data.knockScoreTier}
                priority={s.priority}
              />

              {data.stale && (
                <p className="text-xs text-amber-600">
                  Showing the last saved data — a live refresh wasn’t available.
                </p>
              )}

              <Separator />

              {/* Why this door matters */}
              <section>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Why this door matters
                </h4>
                <ul className="space-y-1 text-sm">
                  {s.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Property facts */}
              <dl className="grid grid-cols-2 gap-3 rounded-md border p-3">
                <Fact label="Built" value={data.yearBuilt ? String(data.yearBuilt) : "Unknown"} />
                <Fact label="Owned since" value={data.ownedSince ? String(data.ownedSince) : "Unknown"} />
                <Fact label="Est. roof age" value={roofAgeLabel(data)} />
                <Fact label="Roof type" value={data.roofType ?? "Unknown"} />
                <Fact label="Est. value" value={money(data.estimatedValue)} />
                <Fact label="Est. equity" value={equityLabel(data)} />
                <Fact label="Last sale" value={data.lastSaleDate ?? "Unknown"} />
                <Fact label="Last roof permit" value={data.lastRoofPermitDate ?? "None on record"} />
              </dl>

              {/* Scripts — tap to copy */}
              <CopyBlock
                title="Recommended opening"
                text={s.recommendedOpening}
                icon={<DoorOpen className="h-3.5 w-3.5" />}
              />
              <CopyBlock
                title="Phone / text script"
                text={s.phoneScript}
                icon={<Phone className="h-3.5 w-3.5" />}
              />

              {/* Talking points */}
              <section>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Talking points
                </h4>
                <ul className="space-y-1 text-sm">
                  {s.talkingPoints.map((t, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground">•</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => copy(s.talkingPoints.map((t) => `• ${t}`).join("\n"), "Notes")}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-3 w-3" /> Copy notes
                </button>
              </section>

              {/* Angles */}
              {(s.financingAngle || s.insuranceAngle) && (
                <section className="space-y-2">
                  {s.financingAngle && (
                    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                      <span className="font-semibold">Financing angle: </span>
                      {s.financingAngle}
                    </div>
                  )}
                  {s.insuranceAngle && (
                    <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
                      <span className="font-semibold">Insurance angle: </span>
                      {s.insuranceAngle}
                    </div>
                  )}
                </section>
              )}

              {/* Caution notes */}
              <section className="rounded-md border border-red-200 bg-red-50 p-3">
                <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Caution
                </h4>
                <ul className="space-y-1 text-sm text-red-900">
                  {s.cautionNotes.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span>•</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Compliance disclaimer */}
              <p className="flex gap-2 rounded-md bg-gray-100 p-3 text-[11px] leading-snug text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {s.disclaimer}
              </p>
            </>
          )}
        </div>

        {/* Sticky actions */}
        {(actions?.onSaveAsLead || actions?.onMarkKnocked || actions?.onSchedule) && (
          <div className="sticky bottom-0 z-10 flex flex-wrap gap-2 border-t bg-white px-4 py-3">
            {actions.onSaveAsLead && (
              <Button size="sm" className="flex-1" onClick={actions.onSaveAsLead}>
                <UserPlus className="mr-1.5 h-4 w-4" />
                {actions.saveLabel ?? "Save as lead"}
              </Button>
            )}
            {actions.onMarkKnocked && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={actions.onMarkKnocked}
              >
                <DoorOpen className="mr-1.5 h-4 w-4" /> Mark knocked
              </Button>
            )}
            {actions.onSchedule && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={actions.onSchedule}
              >
                <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule
              </Button>
            )}
          </div>
        )}
        {isFetching && !isLoading && (
          <div className="px-4 pb-2 text-center text-[11px] text-muted-foreground">
            Refreshing…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
