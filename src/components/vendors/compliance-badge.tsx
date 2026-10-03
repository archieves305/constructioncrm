"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { needsAttention, VERDICT_LABEL, type ComplianceVerdict } from "@/lib/vendors/compliance";

export type ComplianceSummary = { verdict: ComplianceVerdict; gaps: string[] };

const TONE: Record<ComplianceVerdict, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  not_required: "border-gray-200 bg-gray-50 text-gray-600",
  expiring: "border-amber-200 bg-amber-50 text-amber-800",
  missing: "border-red-200 bg-red-50 text-red-700",
  expired: "border-red-200 bg-red-50 text-red-700",
};

/** A vendor's compliance in one pill; the gaps are the tooltip. */
export function ComplianceBadge({ compliance, className }: { compliance: ComplianceSummary; className?: string }) {
  const warn = needsAttention(compliance.verdict);
  const Icon = warn ? AlertTriangle : CheckCircle2;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE[compliance.verdict], className)}
      title={compliance.gaps.join(" · ") || undefined}
    >
      {compliance.verdict !== "not_required" && <Icon className="size-3" />}
      {VERDICT_LABEL[compliance.verdict]}
    </span>
  );
}

/**
 * The warning shown where a vendor is contracted or paid. It never blocks:
 * it says what is missing and leaves the decision with the person.
 */
export function ComplianceCallout({
  compliance,
  vendorName,
  hasVendor = true,
  className,
}: {
  compliance: ComplianceSummary | null | undefined;
  vendorName?: string;
  hasVendor?: boolean;
  className?: string;
}) {
  if (!hasVendor) {
    return (
      <p className={cn("rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground", className)}>
        No vendor record yet, so insurance and W-9 are not tracked for this contractor. Link one under Vendors → Unmatched.
      </p>
    );
  }
  if (!compliance || !needsAttention(compliance.verdict)) return null;
  const serious = compliance.verdict !== "expiring";
  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-xs", serious ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900", className)} role="note">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        <span className="font-medium">{vendorName ? `${vendorName}: ` : ""}</span>
        {compliance.gaps.join(" · ")}. Nothing is blocked — check before you sign or pay.
      </span>
    </div>
  );
}
