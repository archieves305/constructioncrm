"use client";

import { ShieldAlert, Paperclip, CheckSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/shared/callout";
import { WORKFLOW_ROLE_LABEL } from "@/lib/workflows/role-labels";
import type { DependencyDef, PhaseDef, ScopeToggleSpec, TaskDef } from "@/lib/workflows/templates/types";
import { STAGE_TONES } from "@/lib/ui/stage-colors";
import { cn } from "@/lib/utils";
import { phaseToneKey } from "./phase-section";

export type TemplateOutline = {
  template: { key: string; name: string; kind: string; trade: string | null; description: string | null };
  version: { id: string; version: number; status: string; publishedAt: string | null };
  scopeToggles: ScopeToggleSpec[];
  phases: (PhaseDef & { tasks: TaskDef[] })[];
  dependencies: DependencyDef[];
};

/** Read-only view of a template version: every phase and step, what each waits on. */
export function WorkflowOutline({ outline }: { outline: TemplateOutline }) {
  const depsFor = (key: string) => outline.dependencies.filter((d) => d.taskKey === key);
  const titleOf = (ref: string) => {
    if (ref.startsWith("core:")) return `Core › ${humanize(ref.slice(5))}`;
    return outline.phases.flatMap((p) => p.tasks).find((t) => t.key === ref)?.title ?? humanize(ref);
  };
  return (
    <div className="space-y-4">
      {outline.scopeToggles.length > 0 && (
        <div className="rounded-lg border bg-white p-3">
          <p className="text-xs font-medium text-muted-foreground">Scope toggles</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {outline.scopeToggles.map((t) => (
              <Badge key={t.key} variant="outline" className="text-xs">
                {t.label} <span className="ml-1 text-muted-foreground">{t.default ? "on" : "off"} by default</span>
              </Badge>
            ))}
          </div>
        </div>
      )}
      {outline.phases.map((p) => {
        const tone = STAGE_TONES[phaseToneKey(p.band)];
        return (
          <section key={p.key} className="overflow-hidden rounded-lg border bg-white">
            <header className="flex items-center gap-3 border-b px-3 py-2">
              <span className={cn("h-6 w-1 rounded-full", tone.bar)} aria-hidden />
              <h3 className="text-sm font-semibold">{p.name}</h3>
              <span className="text-[11px] text-muted-foreground">band {p.band}</span>
              {p.conditionPermit && (
                <Badge variant="outline" className="text-[10px]">
                  {p.conditionPermit === "REQUIRED" ? "permit required branch" : "no-permit branch"}
                </Badge>
              )}
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{p.tasks.length} steps</span>
            </header>
            {p.note && (
              <div className="px-3 pt-2">
                <Callout tone={p.conditionPermit === "NOT_REQUIRED" ? "warning" : "info"}>{p.note}</Callout>
              </div>
            )}
            <ol className="divide-y">
              {p.tasks.map((t, i) => {
                const deps = depsFor(t.key);
                return (
                  <li key={t.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {t.blocking && <ShieldAlert className="size-3.5 text-tone-warning-fg" aria-label="Blocking gate" />}
                        <span className="font-medium">{t.title}</span>
                        <span className="text-[11px] text-muted-foreground">{WORKFLOW_ROLE_LABEL[t.role]}</span>
                        {t.priority !== "MEDIUM" && <Badge variant="outline" className="text-[10px]">{t.priority}</Badge>}
                        {t.requiredEvidence && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                            <Paperclip className="size-3" /> {t.requiredEvidence.toLowerCase().replace("_", " ")}
                          </span>
                        )}
                        {t.checklist.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                            <CheckSquare className="size-3" /> {t.checklist.length}
                          </span>
                        )}
                        {t.overridesCoreKey && <span className="text-[11px] text-muted-foreground">replaces Core › {humanize(t.overridesCoreKey)}</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                        <span>
                          {t.anchor === "PREDECESSOR" ? "due" : `due from ${t.anchor.toLowerCase().replace("_", " ")}`} +{t.dueOffsetBusinessDays} business day{t.dueOffsetBusinessDays === 1 ? "" : "s"}
                        </span>
                        {deps.length > 0 && <span>after: {deps.map((d) => titleOf(d.dependsOnRef)).join(", ")}</span>}
                        {(t.conditionPermit || t.conditionAnyOf.length > 0 || t.conditionAllOf.length > 0) && (
                          <span>
                            only when
                            {t.conditionPermit ? ` permit ${t.conditionPermit.toLowerCase().replace("_", " ")}` : ""}
                            {t.conditionAnyOf.length > 0 ? ` any of ${t.conditionAnyOf.join(", ")}` : ""}
                            {t.conditionAllOf.length > 0 ? ` all of ${t.conditionAllOf.join(", ")}` : ""}
                          </span>
                        )}
                      </div>
                      {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function humanize(key: string): string {
  return key.replace(/_/g, " ");
}
