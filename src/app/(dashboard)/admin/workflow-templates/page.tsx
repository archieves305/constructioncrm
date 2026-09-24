"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Route } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { useWorkflowTemplates } from "@/components/workflows/use-workflow";
import { WorkflowOutline, type TemplateOutline } from "@/components/workflows/workflow-outline";
import { cn } from "@/lib/utils";

/**
 * The Workflow Template Library, read-only in this release: which templates
 * exist, at what version, and the full outline of each. Editing, drafts and
 * publishing land in the next release; until then the seed files are the
 * source of truth.
 */
export default function WorkflowTemplatesPage() {
  const { data: templates = [], isLoading, error } = useWorkflowTemplates();
  const [selected, setSelected] = useState<string | null>(null);
  const activeKey = selected ?? templates[0]?.key ?? null;
  const { data: outline, isLoading: loadingOutline } = useQuery<TemplateOutline>({
    queryKey: ["workflow-template-outline", activeKey],
    queryFn: () => fetchJson(`/api/workflow-templates/${activeKey}`),
    enabled: Boolean(activeKey),
    retry: retryServerErrors,
  });

  return (
    <div>
      <PageHeader title="Workflow Templates" description="Reusable phase-and-step plans for each trade. Applying one to a job generates its tasks." />
      {error ? (
        <Callout tone="danger" title="Couldn't load the templates">{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </div>
      ) : templates.length === 0 ? (
        <EmptyState icon={Route} title="No published templates" description="Run the workflow seed to load Core Construction and the three trade templates." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <nav aria-label="Templates" className="space-y-1">
            {templates.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSelected(t.key)}
                aria-current={t.key === activeKey ? "page" : undefined}
                className={cn(
                  "w-full rounded-lg border bg-white px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50",
                  t.key === activeKey && "border-brand ring-1 ring-brand/30",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <Badge variant="outline" className={cn("text-[10px]", t.kind === "CORE" && "border-dashed")}>
                    {t.kind === "CORE" ? "Core" : "Trade"} · v{t.version}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.phaseCount} phases · {t.taskCount} steps
                  {t.scopeToggles.length > 0 ? ` · ${t.scopeToggles.length} scope toggles` : ""}
                </p>
                {t.serviceCategoryNames.length > 0 && <p className="mt-0.5 text-[11px] text-muted-foreground">Suggested for: {t.serviceCategoryNames.join(", ")}</p>}
              </button>
            ))}
            <p className="px-1 pt-2 text-[11px] text-muted-foreground">Templates are versioned; jobs keep the version they were applied with. Editing and publishing new versions is coming next.</p>
          </nav>
          <div>
            {loadingOutline || !outline ? (
              <Skeleton className="h-96" />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{outline.template.name}</h2>
                  <Badge variant="outline" className="text-xs">v{outline.version.version} · {outline.version.status.toLowerCase()}</Badge>
                  {outline.template.description && <p className="basis-full text-sm text-muted-foreground">{outline.template.description}</p>}
                </div>
                <WorkflowOutline outline={outline} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
