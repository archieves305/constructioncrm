"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Pencil, Plus, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/session-client";
import { NewTemplateDialog } from "@/components/workflows/new-template-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { useWorkflowTemplates } from "@/components/workflows/use-workflow";
import { WorkflowOutline, type TemplateOutline } from "@/components/workflows/workflow-outline";
import { cn } from "@/lib/utils";

const KIND_LABEL = { CORE: "Core", TRADE: "Trade", VIOLATION: "Violation" } as const;

/**
 * The Workflow Template Library: which templates exist, at what version,
 * and the full outline of each. `kind` narrows it — the Code Violations
 * section shows only VIOLATION templates. Editing lives under /admin.
 */
export function TemplateLibrary({ kind, title, description, emptyDescription }: { kind?: "CORE" | "TRADE" | "VIOLATION"; title: string; description: string; emptyDescription: string }) {
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "ADMIN";
  const { data: templates = [], isLoading, error } = useWorkflowTemplates(undefined, { kind });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const activeKey = selected ?? templates[0]?.key ?? null;
  const { data: outline, isLoading: loadingOutline } = useQuery<TemplateOutline>({
    queryKey: ["workflow-template-outline", activeKey],
    queryFn: () => fetchJson(`/api/workflow-templates/${activeKey}`),
    enabled: Boolean(activeKey),
    retry: retryServerErrors,
  });

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          isAdmin ? (
            <Button variant="brand" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New template
            </Button>
          ) : undefined
        }
      />
      <NewTemplateDialog open={creating} onOpenChange={setCreating} />
      {error ? (
        <Callout tone="danger" title="Couldn't load the templates">{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </div>
      ) : templates.length === 0 ? (
        <EmptyState icon={Route} title="No published templates" description={emptyDescription} />
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
                    {KIND_LABEL[t.kind] ?? t.kind} · v{t.version}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.phaseCount} phases · {t.taskCount} steps
                  {t.scopeToggles.length > 0 ? ` · ${t.scopeToggles.length} scope toggles` : ""}
                </p>
                {t.serviceCategoryNames.length > 0 && <p className="mt-0.5 text-[11px] text-muted-foreground">Suggested for: {t.serviceCategoryNames.join(", ")}</p>}
              </button>
            ))}
            <p className="px-1 pt-2 text-[11px] text-muted-foreground">Templates are versioned; a job or case keeps the version it was applied with until it is upgraded from its Workflow tab.</p>
          </nav>
          <div>
            {loadingOutline || !outline ? (
              <Skeleton className="h-96" />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{outline.template.name}</h2>
                  <Badge variant="outline" className="text-xs">v{outline.version.version} · {outline.version.status.toLowerCase()}</Badge>
                  <Link href={`/admin/workflow-templates/${templates.find((t) => t.key === activeKey)?.id ?? ""}`} className="ml-auto inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-gray-50">
                    <Pencil className="size-3.5" /> {isAdmin ? "Open in editor" : "Versions"}
                  </Link>
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
