"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Copy, Eye, FilePlus2, Pencil, Plus, ShieldAlert, Trash2, Upload, Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { SortableList } from "@/components/ui/sortable-list";
import { Callout } from "@/components/shared/callout";
import { PageHeader } from "@/components/shared/page-header";
import { useSession } from "@/lib/auth/session-client";
import { WORKFLOW_ROLE_LABEL } from "@/lib/workflows/role-labels";
import { slugKey } from "@/lib/workflows/slug";
import { cn } from "@/lib/utils";
import { PhaseEditorDialog, bandLabel } from "./phase-editor-dialog";
import { ScopeTogglesEditor } from "./scope-toggles-editor";
import { TaskEditorSheet } from "./task-editor-sheet";
import { WorkflowOutline, type TemplateOutline } from "./workflow-outline";
import { useAdminTemplate, useEditorMutations, useEditorVersion } from "./use-workflow";
import type { AdminVersionSummary, EditorPhase, EditorTask, EditorVersion, ValidationResultData } from "./types";

const STATUS_PILL: Record<string, string> = {
  DRAFT: "bg-tone-warning-soft text-tone-warning-fg",
  PUBLISHED: "bg-tone-success-soft text-tone-success-fg",
  SUPERSEDED: "bg-gray-100 text-gray-600",
  ARCHIVED: "bg-gray-100 text-gray-400",
};

/**
 * The Workflow Template Library editor. Left: versions, details, scope
 * toggles, phases (sortable). Right: the selected phase's steps
 * (sortable), each opening the step sheet. Validate → Publish is the only
 * way a draft becomes the version new applies use.
 */
export function TemplateEditor({ templateId, versionId }: { templateId: string; versionId: string | null }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "ADMIN";
  const { data: template, isLoading, error } = useAdminTemplate(templateId);
  const activeVid = versionId ?? pickVersion(template?.versions ?? []);
  const { data: version } = useEditorVersion(activeVid);
  const m = useEditorMutations(templateId, activeVid);

  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [editPhase, setEditPhase] = useState<{ phase: EditorPhase | null } | null>(null);
  const [editTask, setEditTask] = useState<{ task: EditorTask | null; phaseId: string } | null>(null);
  const [validation, setValidation] = useState<ValidationResultData | null>(null);
  const [preview, setPreview] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [confirmDeletePhase, setConfirmDeletePhase] = useState<EditorPhase | null>(null);

  const readOnly = !isAdmin || version?.status !== "DRAFT";
  const selectedPhase = version?.phases.find((p) => p.id === phaseId) ?? version?.phases[0] ?? null;
  const stepsOf = (pid: string) => (version?.tasks ?? []).filter((t) => t.phaseId === pid).sort((a, b) => a.sortOrder - b.sortOrder);
  const depsOf = (key: string) => (version?.dependencies ?? []).filter((d) => d.taskKey === key);
  const outline = useMemo<TemplateOutline | null>(() => (version ? toOutline(version) : null), [version]);

  if (isLoading || !template) {
    return (
      <div>
        <Skeleton className="mb-4 h-10 w-1/2" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (error) return <Callout tone="danger" title="Couldn't load this template">{error instanceof Error ? error.message : ""}</Callout>;

  const issuesFor = (loc: { phaseKey?: string; taskKey?: string }) => (validation?.issues ?? []).filter((i) => (loc.taskKey ? i.taskKey === loc.taskKey : loc.phaseKey ? i.phaseKey === loc.phaseKey && !i.taskKey : false));
  const errorCount = validation?.issues.filter((i) => i.level === "error").length ?? 0;

  return (
    <div>
      <PageHeader
        title={template.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/admin/workflow-templates" className="inline-flex items-center gap-1 text-brand-fg hover:underline">
              <ArrowLeft className="size-3.5" /> Library
            </Link>
            <span>·</span>
            <span>{template.kind === "CORE" ? "Core Construction" : `Trade · ${template.trade ?? template.name}`}</span>
            <span>·</span>
            <span className="font-mono text-xs">{template.key}</span>
            {template.description && <span className="basis-full text-sm text-muted-foreground">{template.description}</span>}
          </span>
        }
        actions={
          isAdmin ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setMetaOpen(true)}>
                <Pencil className="size-3.5" /> Details
              </Button>
              {template.kind !== "CORE" && (
                <Button variant="outline" size="sm" onClick={() => setDupOpen(true)}>
                  <Copy className="size-3.5" /> Duplicate
                </Button>
              )}
              {!template.versions.some((v) => v.status === "DRAFT") && (
                <Button variant="brand" size="sm" disabled={m.createDraft.isPending} onClick={() => m.createDraft.mutate(undefined, { onSuccess: (v) => router.replace(`/admin/workflow-templates/${templateId}?v=${v.id}`) })}>
                  <FilePlus2 className="size-3.5" /> {m.createDraft.isPending ? "Creating…" : "Create draft"}
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {/* Version bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-white px-3 py-2">
        <span className="text-xs text-muted-foreground">Versions</span>
        {template.versions.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => router.replace(`/admin/workflow-templates/${templateId}?v=${v.id}`)}
            aria-current={v.id === activeVid ? "true" : undefined}
            className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs", v.id === activeVid ? "border-brand bg-brand/5" : "hover:bg-gray-50")}
          >
            v{v.version}
            <span className={cn("rounded-full px-1.5 text-[10px] font-medium", STATUS_PILL[v.status])}>{v.status.toLowerCase()}</span>
            {v._count.modules > 0 && <span className="text-[10px] text-muted-foreground">{v._count.modules} job{v._count.modules === 1 ? "" : "s"}</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-xs" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
            <Eye className="size-3.5" /> {preview ? "Edit" : "Preview"}
          </Button>
          {version && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={m.validate.isPending} onClick={() => m.validate.mutate(undefined, { onSuccess: setValidation })}>
              <CheckCircle2 className="size-3.5" /> Validate
            </Button>
          )}
          {isAdmin && version?.status === "DRAFT" && (
            <Button size="sm" variant="brand" className="h-7 text-xs" onClick={() => setPublishOpen(true)}>
              <Upload className="size-3.5" /> Publish
            </Button>
          )}
          {isAdmin && version && (version.status === "DRAFT" || version.status === "SUPERSEDED") && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={m.archive.isPending} onClick={() => m.archive.mutate()}>
              <Archive className="size-3.5" /> Archive
            </Button>
          )}
        </div>
      </div>

      {version?.status === "PUBLISHED" && isAdmin && (
        <Callout tone="info" className="mb-4">
          v{version.version} is published and {version.referencedByJobs > 0 ? `pinned by ${version.referencedByJobs} job${version.referencedByJobs === 1 ? "" : "s"}` : "not on any job yet"}. It cannot be edited — create a draft to make changes, then publish that.
        </Callout>
      )}
      {validation && (
        <Callout tone={validation.ok ? "success" : "danger"} className="mb-4" title={validation.ok ? "Valid — ready to publish" : `${errorCount} problem${errorCount === 1 ? "" : "s"} to fix`} action={<button type="button" className="text-xs underline" onClick={() => setValidation(null)}>dismiss</button>}>
          {validation.issues.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {validation.issues.slice(0, 12).map((i, n) => (
                <li key={n} className="flex items-center gap-2 text-[12px]">
                  <span className={i.level === "error" ? "" : "opacity-70"}>{i.message}</span>
                  {(i.taskKey || i.phaseKey) && version && (
                    <button
                      type="button"
                      className="shrink-0 underline"
                      onClick={() => {
                        const t = i.taskKey ? version.tasks.find((x) => x.key === i.taskKey) : null;
                        const p = i.phaseKey ? version.phases.find((x) => x.key === i.phaseKey) : t ? version.phases.find((x) => x.id === t.phaseId) : null;
                        if (p) setPhaseId(p.id);
                        if (t) setEditTask({ task: t, phaseId: t.phaseId });
                      }}
                    >
                      Go to {i.taskKey ? "step" : "phase"}
                    </button>
                  )}
                </li>
              ))}
              {validation.issues.length > 12 && <li className="text-[12px] opacity-70">and {validation.issues.length - 12} more</li>}
            </ul>
          )}
        </Callout>
      )}

      {!version ? (
        <Skeleton className="h-96" />
      ) : preview && outline ? (
        <WorkflowOutline outline={outline} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <div className="space-y-4">
            <section className="rounded-lg border bg-white p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scope toggles</h3>
              <div className="mt-2">
                <ScopeTogglesEditor toggles={version.scopeToggles} readOnly={readOnly} pending={m.setToggles.isPending} onSave={(t) => m.setToggles.mutate(t)} />
              </div>
            </section>
            <section className="rounded-lg border bg-white p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phases</h3>
                {!readOnly && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditPhase({ phase: null })}>
                    <Plus className="size-3.5" /> Phase
                  </Button>
                )}
              </div>
              <div className="mt-2">
                {version.phases.length === 0 && <p className="text-xs text-muted-foreground">No phases yet.</p>}
                <SortableList
                  label="Phases"
                  disabled={readOnly}
                  items={[...version.phases].sort((a, b) => a.sortOrder - b.sortOrder)}
                  onReorder={(ids) => m.reorderPhases.mutate(ids)}
                  itemClassName="border-0"
                  renderItem={(p) => {
                    const issues = issuesFor({ phaseKey: p.key });
                    return (
                      <button
                        type="button"
                        onClick={() => setPhaseId(p.id)}
                        aria-current={selectedPhase?.id === p.id ? "true" : undefined}
                        className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50", selectedPhase?.id === p.id && "bg-brand/5 ring-1 ring-brand/30")}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {bandLabel(p.band)} · {stepsOf(p.id).length} steps
                            {p.conditionPermit ? ` · ${p.conditionPermit === "REQUIRED" ? "permit branch" : "no-permit branch"}` : ""}
                          </span>
                        </span>
                        {issues.length > 0 && <ShieldAlert className="size-3.5 shrink-0 text-tone-danger-fg" aria-label="Has problems" />}
                      </button>
                    );
                  }}
                />
              </div>
            </section>
          </div>

          <section className="rounded-lg border bg-white">
            {selectedPhase ? (
              <>
                <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">{selectedPhase.name}</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {bandLabel(selectedPhase.band)} · key {selectedPhase.key}
                      {selectedPhase.note ? ` · ${selectedPhase.note.slice(0, 80)}${selectedPhase.note.length > 80 ? "…" : ""}` : ""}
                    </p>
                  </div>
                  {!readOnly && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditPhase({ phase: selectedPhase })}>
                        <Pencil className="size-3.5" /> Edit phase
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-tone-danger-fg" onClick={() => setConfirmDeletePhase(selectedPhase)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                      <Button size="sm" className="h-7 text-xs" onClick={() => setEditTask({ task: null, phaseId: selectedPhase.id })}>
                        <Plus className="size-3.5" /> Step
                      </Button>
                    </>
                  )}
                </header>
                <div className="p-3">
                  {stepsOf(selectedPhase.id).length === 0 && <p className="text-xs text-muted-foreground">No steps in this phase yet.</p>}
                  <SortableList
                    label={`Steps in ${selectedPhase.name}`}
                    disabled={readOnly}
                    items={stepsOf(selectedPhase.id)}
                    onReorder={(ids) => m.reorderTasks.mutate({ phaseId: selectedPhase.id, ids })}
                    renderItem={(t, i) => {
                      const deps = depsOf(t.key);
                      const issues = issuesFor({ taskKey: t.key });
                      return (
                        <button type="button" onClick={() => setEditTask({ task: t, phaseId: t.phaseId })} className="flex w-full items-start gap-3 px-2 py-2 text-left hover:bg-gray-50">
                          <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              {t.blocking && <ShieldAlert className="size-3.5 text-tone-warning-fg" aria-label="Blocking gate" />}
                              <span className="text-sm font-medium">{t.title}</span>
                              <span className="text-[11px] text-muted-foreground">{WORKFLOW_ROLE_LABEL[t.role]}</span>
                              {t.priority !== "MEDIUM" && (
                                <Badge variant="outline" className="text-[10px]">
                                  {t.priority}
                                </Badge>
                              )}
                              {issues.length > 0 && <span className="rounded-full bg-tone-danger-soft px-1.5 text-[10px] text-tone-danger-fg">{issues.length} problem{issues.length === 1 ? "" : "s"}</span>}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              <span className="font-mono">{t.key}</span> · {t.anchor === "PREDECESSOR" ? "" : `from ${t.anchor.toLowerCase().replace("_", " ")} `}+{t.dueOffsetBusinessDays}d
                              {deps.length > 0 ? ` · after ${deps.length} step${deps.length === 1 ? "" : "s"}` : ""}
                              {t.requiredEvidence ? ` · needs ${t.requiredEvidence.toLowerCase().replace("_", " ")}` : ""}
                              {t.checklist.length > 0 ? ` · ${t.checklist.length} checks` : ""}
                              {t.conditionPermit ? ` · ${t.conditionPermit === "REQUIRED" ? "permit only" : "no-permit only"}` : ""}
                              {t.conditionAnyOf.length > 0 ? ` · any of ${t.conditionAnyOf.join(", ")}` : ""}
                              {t.overridesCoreKey ? ` · replaces core ${t.overridesCoreKey}` : ""}
                            </span>
                          </span>
                        </button>
                      );
                    }}
                  />
                </div>
              </>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">Add a phase to start.</p>
            )}
          </section>
        </div>
      )}

      {/* Dialogs */}
      {version && (
        <>
          <PhaseEditorDialog
            phase={editPhase?.phase ?? null}
            open={Boolean(editPhase)}
            onOpenChange={(o) => !o && setEditPhase(null)}
            pending={m.addPhase.isPending || m.updatePhase.isPending}
            onSave={(input) => {
              const done = () => setEditPhase(null);
              if (editPhase?.phase) m.updatePhase.mutate({ id: editPhase.phase.id, ...input }, { onSuccess: done });
              else m.addPhase.mutate(input, { onSuccess: done });
            }}
          />
          {editTask && (
            <TaskEditorSheet
              version={version}
              task={editTask.task}
              phaseId={editTask.phaseId}
              open
              onOpenChange={(o) => !o && setEditTask(null)}
              pending={m.addTask.isPending || m.updateTask.isPending}
              onSave={(input) => {
                const done = () => setEditTask(null);
                if (editTask.task) m.updateTask.mutate({ id: editTask.task.id, ...input }, { onSuccess: done });
                else m.addTask.mutate(input, { onSuccess: done });
              }}
              onDelete={readOnly ? undefined : () => editTask.task && m.deleteTask.mutate(editTask.task.id, { onSuccess: () => setEditTask(null) })}
            />
          )}
        </>
      )}
      <Dialog open={Boolean(confirmDeletePhase)} onOpenChange={(o) => !o && setConfirmDeletePhase(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{confirmDeletePhase?.name}”?</DialogTitle>
            <DialogDescription>Its {confirmDeletePhase ? stepsOf(confirmDeletePhase.id).length : 0} steps and every dependency on them are removed from this draft.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDeletePhase(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={m.deletePhase.isPending} onClick={() => confirmDeletePhase && m.deletePhase.mutate(confirmDeletePhase.id, { onSuccess: () => setConfirmDeletePhase(null) })}>
              Delete phase
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} version={version ?? null} pending={m.publish.isPending} onPublish={(notes) => m.publish.mutate(notes, { onSuccess: () => setPublishOpen(false) })} />
      <DuplicateDialog open={dupOpen} onOpenChange={setDupOpen} sourceName={template.name} pending={m.duplicate.isPending} onDuplicate={(body) => m.duplicate.mutate(body, { onSuccess: (t) => router.push(`/admin/workflow-templates/${t.id}`) })} />
      <MetaDialog open={metaOpen} onOpenChange={setMetaOpen} template={template} pending={m.updateMeta.isPending} onSave={(body) => m.updateMeta.mutate(body, { onSuccess: () => setMetaOpen(false) })} />
    </div>
  );
}

function pickVersion(versions: AdminVersionSummary[]): string | null {
  return versions.find((v) => v.status === "DRAFT")?.id ?? versions.find((v) => v.status === "PUBLISHED")?.id ?? versions[0]?.id ?? null;
}

function toOutline(v: EditorVersion): TemplateOutline {
  const phaseKey = new Map(v.phases.map((p) => [p.id, p.key]));
  return {
    template: v.template,
    version: { id: v.id, version: v.version, status: v.status, publishedAt: v.publishedAt },
    scopeToggles: v.scopeToggles,
    phases: [...v.phases]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({
        key: p.key,
        name: p.name,
        band: p.band,
        sortOrder: p.sortOrder,
        description: p.description,
        note: p.note,
        conditionPermit: p.conditionPermit,
        tasks: v.tasks
          .filter((t) => t.phaseId === p.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((t) => ({
            key: t.key,
            phaseKey: phaseKey.get(t.phaseId) ?? p.key,
            title: t.title,
            description: t.description,
            role: t.role,
            priority: t.priority,
            anchor: t.anchor,
            dueOffsetBusinessDays: t.dueOffsetBusinessDays,
            durationBusinessDays: t.durationBusinessDays,
            autoActivate: t.autoActivate,
            blocking: t.blocking,
            requiredEvidence: t.requiredEvidence,
            requiredEvidenceParam: t.requiredEvidenceParam,
            checklist: t.checklist.map((c, i) => ({ key: c.key ?? `item_${i + 1}`, label: c.label, condition: c.condition ?? null })),
            conditionPermit: t.conditionPermit,
            conditionAnyOf: t.conditionAnyOf,
            conditionAllOf: t.conditionAllOf,
            overridesCoreKey: t.overridesCoreKey,
            sortOrder: t.sortOrder,
          })),
      })),
    dependencies: v.dependencies,
  };
}

function PublishDialog({ open, onOpenChange, version, pending, onPublish }: { open: boolean; onOpenChange: (o: boolean) => void; version: EditorVersion | null; pending: boolean; onPublish: (notes: string | null) => void }) {
  const [notes, setNotes] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish v{version?.version}?</DialogTitle>
          <DialogDescription>
            New workflow applies will use this version. Jobs already on an older version keep it until someone upgrades them from their Workflow tab. The draft is validated first; publishing fails if anything is wrong.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="pub-notes" className="text-xs">
            What changed (optional)
          </Label>
          <Textarea id="pub-notes" rows={3} className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={pending} onClick={() => onPublish(notes.trim() || null)}>
            {pending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DuplicateDialog({ open, onOpenChange, sourceName, pending, onDuplicate }: { open: boolean; onOpenChange: (o: boolean) => void; sourceName: string; pending: boolean; onDuplicate: (body: { key: string; name: string }) => void }) {
  const [name, setName] = useState(`${sourceName} (copy)`);
  const [key, setKey] = useState(slugKey(`${sourceName} copy`));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate {sourceName}</DialogTitle>
          <DialogDescription>A new trade template whose first draft is a copy of this one.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="dup-name" className="text-xs">
              Name
            </Label>
            <Input id="dup-name" className="mt-1" value={name} onChange={(e) => { setName(e.target.value); setKey(slugKey(e.target.value)); }} />
          </div>
          <div>
            <Label htmlFor="dup-key" className="text-xs">
              Key
            </Label>
            <Input id="dup-key" className="mt-1 font-mono text-xs" value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending || !name.trim() || !key.trim()} onClick={() => onDuplicate({ key: key.trim(), name: name.trim() })}>
            {pending ? "Duplicating…" : "Duplicate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetaDialog({ open, onOpenChange, template, pending, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; template: { name: string; trade: string | null; description: string | null; isActive: boolean; kind: string }; pending: boolean; onSave: (body: { name?: string; trade?: string | null; description?: string | null; isActive?: boolean }) => void }) {
  const [name, setName] = useState(template.name);
  const [trade, setTrade] = useState(template.trade ?? "");
  const [description, setDescription] = useState(template.description ?? "");
  const [isActive, setIsActive] = useState(template.isActive);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Template details</DialogTitle>
          <DialogDescription>Name and description apply to every version. An inactive template is hidden from Apply.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="meta-name" className="text-xs">
              Name
            </Label>
            <Input id="meta-name" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {template.kind !== "CORE" && (
            <div>
              <Label htmlFor="meta-trade" className="text-xs">
                Trade label
              </Label>
              <Input id="meta-trade" className="mt-1" value={trade} onChange={(e) => setTrade(e.target.value)} />
            </div>
          )}
          <div>
            <Label htmlFor="meta-desc" className="text-xs">
              Description
            </Label>
            <Textarea id="meta-desc" rows={2} className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {template.kind !== "CORE" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active (offered when applying a workflow)
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending || !name.trim()} onClick={() => onSave({ name: name.trim(), trade: trade.trim() || null, description: description.trim() || null, isActive })}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
