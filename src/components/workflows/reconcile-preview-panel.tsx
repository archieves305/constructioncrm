"use client";

import { Callout } from "@/components/shared/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ReconcileItem, ReconcilePlanData } from "./types";

/**
 * "What will change" before a re-plan is confirmed. Four lists — To add,
 * To reinstate, To skip, Kept — so nobody is surprised by a step going
 * Skipped, plus drift and warnings.
 */
export function ReconcilePreviewPanel({
  plan,
  retain,
  onRetainChange,
}: {
  plan: ReconcilePlanData;
  /** remove-module only: ids the user chose to keep instead of skipping. */
  retain?: Set<string>;
  onRetainChange?: (id: string, keep: boolean) => void;
}) {
  const kept = plan.preserved;
  const tile = (label: string, n: number, tone: string) => (
    <div className={cn("rounded-md border p-2.5", tone)}>
      <p className="text-[11px] opacity-80">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{n}</p>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tile("To add", plan.toCreate.length, "bg-tone-success-soft text-tone-success-fg")}
        {tile("To reinstate", plan.toReinstate.length, "bg-tone-info-soft text-tone-info-fg")}
        {tile("To skip", plan.toSkip.length - (retain?.size ?? 0), "bg-tone-warning-soft text-tone-warning-fg")}
        {tile("Kept as-is", kept.length + (retain?.size ?? 0), "bg-gray-50 text-gray-700")}
      </div>

      {plan.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}
      {plan.drift.length > 0 && (
        <Callout tone="info" title={`${plan.drift.length} step${plan.drift.length === 1 ? "" : "s"} changed wording in the new version`}>
          Existing tasks keep their current titles; only new steps use the new wording.
          <ul className="mt-1 space-y-0.5">
            {plan.drift.slice(0, 6).map((d) => (
              <li key={`${d.key}:${d.field}`} className="truncate text-[12px]">
                <span className="opacity-70">{d.field}:</span> “{d.from}” → “{d.to}”
              </li>
            ))}
            {plan.drift.length > 6 && <li className="text-[12px] opacity-70">and {plan.drift.length - 6} more</li>}
          </ul>
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ItemList title="To add" items={plan.toCreate} empty="Nothing new." tone="text-tone-success-fg" />
        <div className="space-y-4">
          <ItemList
            title="To skip"
            items={plan.toSkip}
            empty="No open steps leave the plan."
            tone="text-tone-warning-fg"
            renderExtra={
              onRetainChange
                ? (t) => (
                    <label className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <Checkbox checked={retain?.has(t.id!) ?? false} onCheckedChange={(v) => onRetainChange(t.id!, Boolean(v))} aria-label={`Keep ${t.title}`} />
                      keep
                    </label>
                  )
                : undefined
            }
          />
          {plan.toReinstate.length > 0 && <ItemList title="To reinstate" items={plan.toReinstate} empty="" tone="text-tone-info-fg" />}
        </div>
      </div>
      {kept.length > 0 && (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Kept as-is ({kept.length}) — completed, manual, corrections and steps someone skipped</summary>
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
            {kept.map((t) => (
              <li key={t.id ?? t.key} className="flex justify-between gap-2 truncate text-[12px]">
                <span className="truncate">{t.title}</span>
                <span className="shrink-0 text-muted-foreground">{t.why.replace("-", " ")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-[11px] text-muted-foreground">
        Nothing is deleted. Skipped steps stay on the job with the reason on their timeline; a later re-plan can bring them back.
      </p>
    </div>
  );
}

function ItemList({ title, items, empty, tone, renderExtra }: { title: string; items: ReconcileItem[]; empty: string; tone: string; renderExtra?: (t: ReconcileItem) => React.ReactNode }) {
  return (
    <div>
      <p className={cn("text-xs font-medium", tone)}>
        {title} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto text-sm">
          {items.slice(0, 60).map((t) => (
            <li key={t.id ?? t.key} className="flex items-center gap-2">
              {t.blocking && <span className="text-tone-warning-fg" title="Blocking gate">⛔</span>}
              <span className="truncate">{t.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{t.moduleKey.replace(/_/g, " ")}</span>
              {renderExtra?.(t)}
            </li>
          ))}
          {items.length > 60 && <li className="text-xs text-muted-foreground">and {items.length - 60} more</li>}
        </ul>
      )}
    </div>
  );
}
