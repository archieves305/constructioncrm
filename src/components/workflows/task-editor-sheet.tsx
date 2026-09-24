"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Callout } from "@/components/shared/callout";
import { WORKFLOW_ROLE_LABEL, WORKFLOW_ROLES } from "@/lib/workflows/role-labels";
import { findCycle } from "@/lib/workflows/dependencies";
import { cn } from "@/lib/utils";
import type { EditorChecklistItem, EditorTask, EditorVersion, TaskTemplateInput, WorkflowRole } from "./types";
import type { TaskDependencyKind, WorkflowAnchor, WorkflowEvidenceType } from "@/generated/prisma/client";

const ANCHORS: { value: WorkflowAnchor; label: string }[] = [
  { value: "PREDECESSOR", label: "Predecessor finished" },
  { value: "PHASE_START", label: "Phase starts" },
  { value: "JOB_CREATED", label: "Job created / applied" },
  { value: "APPLIED_AT", label: "Workflow applied" },
  { value: "TARGET_START", label: "Target start date" },
];
const EVIDENCE: { value: WorkflowEvidenceType | "none"; label: string }[] = [
  { value: "none", label: "Nothing extra" },
  { value: "ATTACHMENT", label: "An attached document" },
  { value: "PHOTO", label: "A photo" },
  { value: "PERMIT_NUMBER", label: "Permit number on the job" },
  { value: "PERMIT_DETERMINATION", label: "Permit status decided" },
  { value: "INSPECTION_RESULT", label: "Inspection result (pass)" },
  { value: "PAYMENT_STATUS", label: "Payment recorded" },
  { value: "NOTE", label: "A note" },
];

type DepDraft = { ref: string; kind: TaskDependencyKind };

/**
 * The step editor. Every field of a template step, a depends-on picker
 * with a client-side cycle check, checklist lines and the condition
 * builder — no raw JSON anywhere.
 */
export function TaskEditorSheet({
  version,
  task,
  phaseId,
  open,
  onOpenChange,
  onSave,
  onDelete,
  pending,
}: {
  version: EditorVersion;
  task: EditorTask | null;
  phaseId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (input: TaskTemplateInput) => void;
  onDelete?: () => void;
  pending?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {open && <Body version={version} task={task} phaseId={phaseId} onCancel={() => onOpenChange(false)} onSave={onSave} onDelete={onDelete} pending={pending} />}
      </SheetContent>
    </Sheet>
  );
}

function Body({ version, task, phaseId, onCancel, onSave, onDelete, pending }: { version: EditorVersion; task: EditorTask | null; phaseId: string; onCancel: () => void; onSave: (input: TaskTemplateInput) => void; onDelete?: () => void; pending?: boolean }) {
  const isCore = version.template.kind === "CORE";
  const toggles = version.scopeToggles;
  const [title, setTitle] = useState(task?.title ?? "");
  const [key, setKey] = useState(task?.key ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [role, setRole] = useState<WorkflowRole>(task?.role ?? "PROJECT_MANAGER");
  const [priority, setPriority] = useState(task?.priority ?? "MEDIUM");
  const [anchor, setAnchor] = useState<WorkflowAnchor>(task?.anchor ?? "PREDECESSOR");
  const [offset, setOffset] = useState(String(task?.dueOffsetBusinessDays ?? 2));
  const [duration, setDuration] = useState(task?.durationBusinessDays != null ? String(task.durationBusinessDays) : "");
  const [autoActivate, setAutoActivate] = useState(task?.autoActivate ?? true);
  const [blocking, setBlocking] = useState(task?.blocking ?? false);
  const [evidence, setEvidence] = useState<WorkflowEvidenceType | "none">(task?.requiredEvidence ?? "none");
  const [evidenceParam, setEvidenceParam] = useState(task?.requiredEvidenceParam ?? "");
  const [checklist, setChecklist] = useState<EditorChecklistItem[]>(task?.checklist ?? []);
  const [permit, setPermit] = useState<"none" | "REQUIRED" | "NOT_REQUIRED">(task?.conditionPermit ?? "none");
  const [anyOf, setAnyOf] = useState<string[]>(task?.conditionAnyOf ?? []);
  const [allOf, setAllOf] = useState<string[]>(task?.conditionAllOf ?? []);
  const [overrides, setOverrides] = useState(task?.overridesCoreKey ?? "none");
  const [deps, setDeps] = useState<DepDraft[]>(() => version.dependencies.filter((d) => task && d.taskKey === task.key).map((d) => ({ ref: d.dependsOnRef, kind: d.kind })));
  const [depFilter, setDepFilter] = useState("");
  const [depsOpen, setDepsOpen] = useState(false);

  const phaseOf = useMemo(() => new Map(version.phases.map((p) => [p.id, p])), [version.phases]);
  const otherSteps = useMemo(() => version.tasks.filter((t) => !task || t.id !== task.id), [version.tasks, task]);
  const candidates = useMemo(() => {
    const own = otherSteps.map((t) => ({ ref: t.key, title: t.title, group: phaseOf.get(t.phaseId)?.name ?? "" }));
    const core = isCore ? [] : version.coreSteps.map((c) => ({ ref: `core:${c.key}`, title: c.title, group: "Core Construction" }));
    const q = depFilter.trim().toLowerCase();
    return [...own, ...core].filter((c) => !q || c.title.toLowerCase().includes(q) || c.ref.includes(q));
  }, [otherSteps, version.coreSteps, isCore, phaseOf, depFilter]);

  // Cycle check: this step's edges replaced by the draft, over the in-template graph.
  const cycle = useMemo(() => {
    const myKey = task?.key ?? (key.trim() || "__new__");
    const edges = version.dependencies
      .filter((d) => d.taskKey !== myKey && !d.dependsOnRef.includes(":"))
      .map((d) => ({ task: d.taskKey, dependsOn: d.dependsOnRef, kind: d.kind }));
    for (const d of deps) if (!d.ref.includes(":")) edges.push({ task: myKey, dependsOn: d.ref, kind: d.kind });
    const nodes = new Set([...version.tasks.map((t) => t.key), myKey]);
    return findCycle(nodes, edges);
  }, [deps, version.dependencies, version.tasks, task?.key, key]);

  const titleOf = (ref: string) => (ref.startsWith("core:") ? `Core › ${version.coreSteps.find((c) => `core:${c.key}` === ref)?.title ?? ref.slice(5)}` : (version.tasks.find((t) => t.key === ref)?.title ?? ref));
  const toggleIn = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const valid = title.trim().length > 0 && !cycle && Number.isInteger(Number(offset));

  function save() {
    onSave({
      phaseId,
      key: key.trim() || undefined,
      title: title.trim(),
      description: description.trim() || null,
      role,
      priority,
      anchor,
      dueOffsetBusinessDays: Number(offset),
      durationBusinessDays: duration.trim() ? Number(duration) : null,
      autoActivate,
      blocking,
      requiredEvidence: evidence === "none" ? null : evidence,
      requiredEvidenceParam: evidence === "PAYMENT_STATUS" && evidenceParam.trim() ? evidenceParam.trim().toUpperCase() : null,
      checklist: checklist.filter((c) => c.label.trim()).map((c) => ({ label: c.label.trim(), condition: c.condition ?? null })),
      conditionPermit: permit === "none" ? null : permit,
      conditionAnyOf: anyOf,
      conditionAllOf: allOf,
      overridesCoreKey: overrides === "none" ? null : overrides,
      dependsOn: deps,
    });
  }

  return (
    <>
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle className="text-base">{task ? "Edit step" : "New step"}</SheetTitle>
        <p className="text-xs text-muted-foreground">
          {phaseOf.get(phaseId)?.name}
          {task ? ` · key ${task.key}` : ""}
        </p>
      </SheetHeader>
      <div className="space-y-5 px-6 py-5">
        <div>
          <Label htmlFor="st-title" className="text-xs">
            Title
          </Label>
          <Input id="st-title" autoFocus className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Submit permit package" />
        </div>
        {!task && (
          <div>
            <Label htmlFor="st-key" className="text-xs">
              Key (optional — made from the title if blank)
            </Label>
            <Input id="st-key" className="mt-1 font-mono text-xs" value={key} onChange={(e) => setKey(e.target.value)} placeholder="submit_permit_package" />
          </div>
        )}
        <div>
          <Label htmlFor="st-desc" className="text-xs">
            Instructions (optional)
          </Label>
          <Textarea id="st-desc" rows={2} className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={(v: string | null) => v && setRole(v as WorkflowRole)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => WORKFLOW_ROLE_LABEL[v as WorkflowRole] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {WORKFLOW_ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={(v: string | null) => v && setPriority(v as typeof priority)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => v.charAt(0) + v.slice(1).toLowerCase()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Due date counts from</Label>
            <Select value={anchor} onValueChange={(v: string | null) => v && setAnchor(v as WorkflowAnchor)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => ANCHORS.find((a) => a.value === v)?.label ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ANCHORS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="st-offset" className="text-xs">
                Business days
              </Label>
              <Input id="st-offset" type="number" className="mt-1" value={offset} onChange={(e) => setOffset(e.target.value)} />
              {anchor !== "TARGET_START" && Number(offset) < 0 && <p className="text-[11px] text-tone-danger-fg">Negative only from the target start date.</p>}
            </div>
            <div>
              <Label htmlFor="st-dur" className="text-xs">
                Duration (optional)
              </Label>
              <Input id="st-dur" type="number" className="mt-1" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={blocking} onCheckedChange={(v) => setBlocking(Boolean(v))} /> Blocking gate
            <span className="text-[11px] text-muted-foreground">(only an admin or manager may skip it)</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={autoActivate} onCheckedChange={(v) => setAutoActivate(Boolean(v))} /> Becomes Ready automatically
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Waits on</Label>
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setDepsOpen((o) => !o)}>
              <Plus className="size-3" /> {depsOpen ? "Done" : "Add"}
            </Button>
          </div>
          {deps.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Nothing — Ready from the start of its phase.</p>}
          <ul className="mt-1 space-y-1">
            {deps.map((d) => (
              <li key={d.ref} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{titleOf(d.ref)}</span>
                <Select value={d.kind} onValueChange={(v: string | null) => v && setDeps((ds) => ds.map((x) => (x.ref === d.ref ? { ...x, kind: v as TaskDependencyKind } : x)))}>
                  <SelectTrigger className="h-6 w-[110px] text-[11px]">
                    <SelectValue>{(v: string) => (v === "BLOCKING" ? "blocks" : "date only")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BLOCKING">blocks</SelectItem>
                    <SelectItem value="DATE_ONLY">date only</SelectItem>
                  </SelectContent>
                </Select>
                <button type="button" aria-label={`Remove ${titleOf(d.ref)}`} className="rounded p-0.5 text-muted-foreground hover:bg-gray-100" onClick={() => setDeps((ds) => ds.filter((x) => x.ref !== d.ref))}>
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          {cycle && <Callout tone="danger" className="mt-2" title="That would create a loop">{cycle.map((k) => titleOf(k)).join(" → ")}</Callout>}
          {depsOpen && (
            <div className="mt-2 rounded-md border p-2">
              <Input className="h-8 text-xs" placeholder="Filter steps…" value={depFilter} onChange={(e) => setDepFilter(e.target.value)} />
              <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                {candidates
                  .filter((c) => !deps.some((d) => d.ref === c.ref))
                  .slice(0, 80)
                  .map((c) => (
                    <li key={c.ref}>
                      <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-gray-50" onClick={() => setDeps((ds) => [...ds, { ref: c.ref, kind: "BLOCKING" }])}>
                        <span className="truncate">{c.title}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{c.group}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs">Required before completing</Label>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <Select value={evidence} onValueChange={(v: string | null) => v && setEvidence(v as typeof evidence)}>
              <SelectTrigger>
                <SelectValue>{(v: string) => EVIDENCE.find((e) => e.value === v)?.label ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {EVIDENCE.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {evidence === "PAYMENT_STATUS" && (
              <Select value={evidenceParam || "ANY"} onValueChange={(v: string | null) => v && setEvidenceParam(v)}>
                <SelectTrigger>
                  <SelectValue>{(v: string) => (v === "DEPOSIT" ? "Deposit" : v === "FINAL" ? "Final payment" : "Any payment")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANY">Any payment</SelectItem>
                  <SelectItem value="DEPOSIT">Deposit</SelectItem>
                  <SelectItem value="FINAL">Final payment</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Checklist</Label>
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setChecklist((c) => [...c, { label: "" }])}>
              <Plus className="size-3" /> Line
            </Button>
          </div>
          <ul className="mt-1 space-y-1">
            {checklist.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <Input className="h-8 text-sm" value={c.label} placeholder="What to check" onChange={(e) => setChecklist((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                {toggles.length > 0 && (
                  <Select value={c.condition?.anyOf?.[0] ?? "always"} onValueChange={(v: string | null) => setChecklist((all) => all.map((x, j) => (j === i ? { ...x, condition: !v || v === "always" ? null : { anyOf: [v] } } : x)))}>
                    <SelectTrigger className="h-8 w-[150px] text-[11px]">
                      <SelectValue>{(v: string) => (v === "always" ? "always" : `only if ${toggles.find((t) => t.key === v)?.label ?? v}`)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="always">always</SelectItem>
                      {toggles.map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          only if {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <button type="button" aria-label="Remove line" className="rounded p-1 text-muted-foreground hover:bg-gray-100" onClick={() => setChecklist((all) => all.filter((_, j) => j !== i))}>
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <Label className="text-xs">Only include this step when…</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-[11px] text-muted-foreground">Permit</p>
              <Select value={permit} onValueChange={(v: string | null) => v && setPermit(v as typeof permit)}>
                <SelectTrigger className="mt-0.5 h-8 text-xs">
                  <SelectValue>{(v: string) => (v === "REQUIRED" ? "a permit is required" : v === "NOT_REQUIRED" ? "no permit is required" : "either way")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">either way</SelectItem>
                  <SelectItem value="REQUIRED">a permit is required</SelectItem>
                  <SelectItem value="NOT_REQUIRED">no permit is required</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isCore && (
              <div>
                <p className="text-[11px] text-muted-foreground">Replaces a Core step</p>
                <Select value={overrides} onValueChange={(v: string | null) => v && setOverrides(v)}>
                  <SelectTrigger className="mt-0.5 h-8 text-xs">
                    <SelectValue>{(v: string) => (v === "none" ? "No" : (version.coreSteps.find((c) => c.key === v)?.title ?? v))}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No</SelectItem>
                    {version.coreSteps.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {toggles.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-[11px] text-muted-foreground">Any of these scope toggles is on</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {toggles.map((t) => (
                    <button key={t.key} type="button" aria-pressed={anyOf.includes(t.key)} onClick={() => setAnyOf((l) => toggleIn(l, t.key))} className={cn("rounded-full border px-2 py-0.5 text-[11px]", anyOf.includes(t.key) && "border-brand bg-brand/10 text-brand-fg")}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">All of these are on</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {toggles.map((t) => (
                    <button key={t.key} type="button" aria-pressed={allOf.includes(t.key)} onClick={() => setAllOf((l) => toggleIn(l, t.key))} className={cn("rounded-full border px-2 py-0.5 text-[11px]", allOf.includes(t.key) && "border-brand bg-brand/10 text-brand-fg")}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t bg-gray-50/60 px-6 py-3">
        {task && onDelete ? (
          <Button variant="ghost" className="text-tone-danger-fg" onClick={onDelete}>
            <Trash2 className="size-4" /> Delete step
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!valid || pending} onClick={save}>
            {pending ? "Saving…" : task ? "Save step" : "Add step"}
          </Button>
        </div>
      </div>
    </>
  );
}
