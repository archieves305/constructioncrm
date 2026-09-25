"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { useSession } from "@/lib/auth/session-client";
import { fetchJson } from "@/lib/fetch-json";
import { LEGAL_NO_PERMIT_WARNING } from "@/lib/workflows/templates/types";
import { WORKFLOW_ROLE_LABEL, WORKFLOW_ROLES } from "@/lib/workflows/role-labels";
import { cn } from "@/lib/utils";
import { PERMIT_STATUS_LABEL } from "./status";
import {
  useApplyWorkflow,
  usePatchWorkflow,
  usePreviewWorkflow,
  useRoleDefaults,
  useWorkflowTemplates,
} from "./use-workflow";
import {
  subjectInfoOf,
  toSubjectRef,
  type ApplyBody,
  type JobWorkflowData,
  type SubjectLike,
  type WorkflowPermitStatus,
  type WorkflowPreviewData,
  type WorkflowRole,
  type WorkflowTemplateOption,
} from "./types";

type LeadFile = { id: string; fileName: string; category: string };

/**
 * Two steps: choose (trades, scope, permit status, team, target start), then
 * review the composed plan before anything is created. `mode="permit-only"`
 * reuses the permit section on its own for the Undetermined callout.
 *
 * On a violation case the "trades" section is instead a single choice among
 * the published violation templates (no Core, no target start).
 */
export function ApplyWorkflowDialog({
  subject,
  data,
  open,
  onOpenChange,
  mode = "apply",
}: {
  subject: SubjectLike;
  data: JobWorkflowData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "apply" | "permit-only";
}) {
  const ref = toSubjectRef(subject);
  // The shell loads what the form needs; the body mounts once that is ready
  // and seeds its own state from props, so closing and reopening starts
  // fresh without any effect-driven resets.
  const { data: templates = [], isLoading: loadingTemplates } = useWorkflowTemplates(ref.kind === "job" ? ref.id : undefined, {
    enabled: open && mode === "apply",
    kind: ref.kind === "violation" ? "VIOLATION" : undefined,
  });
  const { data: roleDefaults = [], isLoading: loadingDefaults } =
    useRoleDefaults({ enabled: open && mode === "apply" });
  const ready =
    mode === "permit-only" || (!loadingTemplates && !loadingDefaults);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[92vh] overflow-y-auto",
          mode === "permit-only" ? "sm:max-w-xl" : "sm:max-w-3xl",
        )}
      >
        {open && ready ? (
          <ApplyWorkflowBody
            subject={ref}
            data={data}
            mode={mode}
            templates={templates}
            roleDefaults={roleDefaults}
            onOpenChange={onOpenChange}
          />
        ) : (
          <div className="space-y-3">
            <DialogHeader>
              <DialogTitle>
                {mode === "permit-only"
                  ? "Set permit status"
                  : "Apply workflow"}
              </DialogTitle>
              <DialogDescription>Loading templates…</DialogDescription>
            </DialogHeader>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ApplyWorkflowBody({
  subject,
  data,
  mode,
  templates,
  roleDefaults,
  onOpenChange,
}: {
  subject: { kind: "job" | "violation"; id: string };
  data: JobWorkflowData;
  mode: "apply" | "permit-only";
  templates: WorkflowTemplateOption[];
  roleDefaults: { role: WorkflowRole; user: { id: string } | null }[];
  onOpenChange: (open: boolean) => void;
}) {
  const info = subjectInfoOf(data);
  const isCase = subject.kind === "violation";
  const { data: session } = useSession();
  const { data: users = [] } = useAssignableUsers();
  const { data: leadFiles = [] } = useQuery<LeadFile[]>({
    queryKey: ["files", "lead", info.leadId],
    queryFn: () => fetchJson(`/api/files?leadId=${info.leadId}`),
  });
  const preview = usePreviewWorkflow(subject);
  const apply = useApplyWorkflow(subject);
  const patch = usePatchWorkflow(subject);

  const trades = useMemo(
    () => templates.filter((t) => (isCase ? t.kind === "VIOLATION" : t.kind === "TRADE")),
    [templates, isCase],
  );
  const core = isCase ? undefined : templates.find((t) => t.kind === "CORE");
  const applied = useMemo(
    () =>
      new Set(
        (data.modules ?? [])
          .filter((m) => !m.removedAt)
          .map((m) => m.templateKey),
      ),
    [data.modules],
  );
  const roles = useMemo(() => WORKFLOW_ROLES.filter((r) => (isCase ? r !== "SALES_REP" : r !== "CASE_MANAGER")), [isCase]);

  const [step, setStep] = useState<"choose" | "review">("choose");
  const [selected, setSelected] = useState<Set<string>>(() => {
    const preselected = trades.filter((t) => t.suggested || applied.has(t.key)).map((t) => t.key);
    // A case runs exactly one template: default to the applied one, else the first published.
    if (isCase) return new Set(preselected.length > 0 ? [preselected[0]!] : trades[0] ? [trades[0].key] : []);
    return new Set(preselected);
  });
  const [toggles, setToggles] = useState<
    Record<string, Record<string, boolean>>
  >(() =>
    Object.fromEntries(
      trades.map((t) => [
        t.key,
        {
          ...Object.fromEntries(t.scopeToggles.map((s) => [s.key, s.default])),
          ...(data.instance?.scopeToggles[t.key] ?? {}),
        },
      ]),
    ),
  );
  const [permitStatus, setPermitStatus] = useState<WorkflowPermitStatus>(
    data.instance?.permitStatus ?? "UNDETERMINED",
  );
  const [permitNotes, setPermitNotes] = useState(
    data.instance?.permitNotes ?? "",
  );
  const [permitFileId, setPermitFileId] = useState<string | null>(
    data.instance?.permitDocumentFileId ?? null,
  );
  const [jurisdiction, setJurisdiction] = useState(info.jurisdiction ?? "");
  const [team, setTeam] = useState<
    Partial<Record<WorkflowRole, string | null>>
  >(() => {
    const t: Partial<Record<WorkflowRole, string | null>> = {};
    for (const slot of data.team ?? []) t[slot.role] = slot.user.id;
    return t;
  });
  const [targetStart, setTargetStart] = useState(
    info.targetStartDate ? info.targetStartDate.slice(0, 10) : "",
  );
  const [previewData, setPreviewData] = useState<WorkflowPreviewData | null>(
    null,
  );

  const defaultFor = (role: WorkflowRole): string | null => {
    if (role === "PROJECT_MANAGER" && info.projectManagerId) return info.projectManagerId;
    if (role === "SALES_REP" && info.salesRepId) return info.salesRepId;
    if (role === "CASE_MANAGER" && info.caseManagerId) return info.caseManagerId;
    return roleDefaults.find((r) => r.role === role)?.user?.id ?? null;
  };

  const body = (): ApplyBody => ({
    templateKeys: Array.from(selected),
    permitStatus,
    scopeToggles: Object.fromEntries(
      Array.from(selected).map((k) => [k, toggles[k] ?? {}]),
    ),
    team,
    ...(isCase ? {} : { targetStartDate: targetStart || null }),
    jurisdiction: jurisdiction.trim() || null,
    permit:
      permitStatus === "UNDETERMINED"
        ? undefined
        : { notes: permitNotes.trim() || null, documentFileId: permitFileId },
  });

  async function goReview() {
    const p = await preview.mutateAsync(body());
    setPreviewData(p);
    setStep("review");
  }

  async function confirmApply() {
    await apply.mutateAsync(body());
    onOpenChange(false);
  }

  async function confirmPermit() {
    if (permitStatus === "UNDETERMINED") return;
    await patch.mutateAsync({
      permit: {
        status: permitStatus,
        notes: permitNotes.trim() || null,
        documentFileId: permitFileId,
        jurisdiction: jurisdiction.trim() || null,
      },
    });
    onOpenChange(false);
  }

  const permitFiles = leadFiles.filter(
    (f) =>
      f.category === "PERMIT" ||
      f.category === "OTHER" ||
      f.category === "SIGNED_DOC",
  );
  const me = session?.user
    ? `${session.user.firstName} ${session.user.lastName}`.trim()
    : "you";
  const loadingTemplates = false;

  const permitSection = (
    <section className="space-y-3">
      <div>
        <Label className="text-xs">Permit status</Label>
        <RadioGroup
          value={permitStatus}
          onValueChange={(v) => setPermitStatus(v as WorkflowPermitStatus)}
          className="mt-1.5 gap-1.5"
        >
          {(
            [
              "REQUIRED",
              "NOT_REQUIRED",
              "UNDETERMINED",
            ] as WorkflowPermitStatus[]
          )
            .filter((s) => mode === "apply" || s !== "UNDETERMINED")
            .map((s) => (
              <label
                key={s}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm",
                  permitStatus === s && "border-brand bg-brand/5",
                )}
              >
                <RadioGroupItem
                  value={s}
                  className="mt-0.5"
                  aria-label={PERMIT_STATUS_LABEL[s]}
                />
                <span>
                  <span className="font-medium">{PERMIT_STATUS_LABEL[s]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {s === "REQUIRED"
                      ? isCase
                        ? "Generates the permit oversight steps; the permit itself is tracked on the linked job."
                        : "Generates the permit application, tracking, posting and inspection steps."
                      : s === "NOT_REQUIRED"
                        ? "Generates the documentation and PM-approval steps instead. Corrective work waits on that approval."
                        : "Generates everything that does not depend on the decision, plus a blocking “Determine permit requirement” step."}
                  </span>
                </span>
              </label>
            ))}
        </RadioGroup>
      </div>
      {permitStatus === "NOT_REQUIRED" && (
        <Callout tone="warning" title="Before you choose this">
          {LEGAL_NO_PERMIT_WARNING}
        </Callout>
      )}
      {permitStatus !== "UNDETERMINED" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Permit confirmed by</Label>
            <Input className="mt-1" value={me} disabled />
          </div>
          <div>
            <Label className="text-xs">Confirmation date</Label>
            <Input
              className="mt-1"
              value={format(new Date(), "MMM d, yyyy")}
              disabled
            />
          </div>
          <div>
            <Label htmlFor="wf-jurisdiction" className="text-xs">
              Jurisdiction
            </Label>
            <Input
              id="wf-jurisdiction"
              className="mt-1"
              placeholder="e.g. City of Miami Building Dept."
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Supporting document (optional)</Label>
            <Select
              value={permitFileId ?? "__none"}
              onValueChange={(v: string | null) =>
                setPermitFileId(!v || v === "__none" ? null : v)
              }
            >
              <SelectTrigger className="mt-1">
                <SelectValue>
                  {(v: string) =>
                    !v || v === "__none"
                      ? "None"
                      : (leadFiles.find((f) => f.id === v)?.fileName ?? "—")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {permitFiles.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="wf-permit-notes" className="text-xs">
              Permit determination notes (optional)
            </Label>
            <Textarea
              id="wf-permit-notes"
              rows={2}
              className="mt-1"
              value={permitNotes}
              onChange={(e) => setPermitNotes(e.target.value)}
              placeholder="Who you spoke to, exemption cited, portal reference…"
            />
          </div>
        </div>
      )}
    </section>
  );

  if (mode === "permit-only") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Set permit status</DialogTitle>
          <DialogDescription>
            Deciding the permit status completes “Determine permit requirement”
            and generates the matching branch of steps.
          </DialogDescription>
        </DialogHeader>
        {permitSection}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={permitStatus === "UNDETERMINED" || patch.isPending}
            onClick={confirmPermit}
          >
            {patch.isPending
              ? "Saving…"
              : permitStatus === "NOT_REQUIRED"
                ? "Confirm — no permit required"
                : "Confirm — permit required"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {step === "choose"
            ? "Apply workflow"
            : "Review before creating tasks"}
        </DialogTitle>
        <DialogDescription>
          {step === "choose"
            ? isCase
              ? `Pick the workflow for ${info.label}, the permit status and who fills each role.`
              : `Core Construction is always included. Pick the trades on ${info.label}, the permit status and who fills each role.`
            : "Nothing has been created yet. Confirm to generate these tasks."}
        </DialogDescription>
      </DialogHeader>

      {step === "choose" && (
        <div className="space-y-6">
          <section>
            <Label className="text-xs">{isCase ? "Workflow template" : "Trades"}</Label>
            {loadingTemplates ? (
              <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            ) : (
              <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                {core && (
                  <div className="rounded-md border border-dashed bg-gray-50 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <Checkbox
                        checked
                        disabled
                        aria-label="Core Construction (always included)"
                      />
                      {core.name}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Always included · {core.taskCount} steps · v{core.version}
                    </p>
                  </div>
                )}
                {trades.map((t) => (
                  <TradeCard
                    key={t.key}
                    template={t}
                    checked={selected.has(t.key)}
                    applied={applied.has(t.key)}
                    single={isCase}
                    onChange={(c) =>
                      setSelected((s) => {
                        if (isCase) return c ? new Set([t.key]) : new Set();
                        const n = new Set(s);
                        if (c) n.add(t.key);
                        else n.delete(t.key);
                        return n;
                      })
                    }
                  />
                ))}
                {isCase && trades.length === 0 && (
                  <p className="text-sm text-muted-foreground sm:col-span-3">No violation workflow template is published. Run the workflow seed, or publish one in the template library.</p>
                )}
              </div>
            )}
            {selected.size === 0 && !loadingTemplates && !isCase && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                No trade selected — only the Core Construction steps will be
                created.
              </p>
            )}
          </section>

          {trades
            .filter((t) => selected.has(t.key) && t.scopeToggles.length > 0)
            .map((t) => (
              <section key={t.key}>
                <Label className="text-xs">{t.name} — scope</Label>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
                  {t.scopeToggles.map((s) => (
                    <label
                      key={s.key}
                      className="flex items-center gap-2 text-sm"
                      title={s.description}
                    >
                      <Checkbox
                        checked={toggles[t.key]?.[s.key] ?? s.default}
                        onCheckedChange={(v) =>
                          setToggles((all) => ({
                            ...all,
                            [t.key]: { ...all[t.key], [s.key]: Boolean(v) },
                          }))
                        }
                        aria-label={s.label}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </section>
            ))}

          {permitSection}

          <section>
            <Label className="text-xs">Team</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isCase
                ? "Empty slots fall back to the case manager (and the linked job's PM), then the company defaults."
                : "Empty slots fall back to the job's PM and sales rep, then the company defaults."}
            </p>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
              {roles.map((role) => {
                const fallback = defaultFor(role);
                const fb = fallback
                  ? users.find((u) => u.id === fallback)
                  : null;
                return (
                  <div key={role}>
                    <Label className="text-[11px] text-muted-foreground">
                      {WORKFLOW_ROLE_LABEL[role]}
                    </Label>
                    <AssigneePicker
                      size="sm"
                      className="mt-0.5 w-full"
                      value={team[role] ?? null}
                      users={users}
                      placeholder={
                        fb
                          ? `${fb.firstName} ${fb.lastName} (default)`
                          : "Unassigned"
                      }
                      onChange={(id) => setTeam((t) => ({ ...t, [role]: id }))}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {!isCase && (
            <section className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="wf-target-start" className="text-xs">
                  Target start date (optional)
                </Label>
                <Input
                  id="wf-target-start"
                  type="date"
                  className="mt-1"
                  value={targetStart}
                  onChange={(e) => setTargetStart(e.target.value)}
                />
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Steps counted back from the start date get dates once this is
                  set.
                </p>
              </div>
            </section>
          )}
        </div>
      )}

      {step === "review" && previewData && (
        <WorkflowPreviewPanel preview={previewData} users={users} />
      )}

      <div className="flex items-center justify-between gap-2 pt-2">
        <div className="text-xs text-muted-foreground">
          {step === "review" ? "Step 2 of 2" : "Step 1 of 2"}
        </div>
        <div className="flex gap-2">
          {step === "review" ? (
            <>
              <Button variant="ghost" onClick={() => setStep("choose")}>
                Back
              </Button>
              <Button
                variant="brand"
                disabled={
                  apply.isPending || (previewData?.counts.toCreate ?? 0) === 0
                }
                onClick={confirmApply}
              >
                {apply.isPending
                  ? "Creating…"
                  : previewData && previewData.counts.toCreate === 0
                    ? "Nothing new to create"
                    : `Apply workflow — create ${previewData?.counts.toCreate ?? 0} tasks`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={preview.isPending || loadingTemplates || (isCase && selected.size !== 1)}
                onClick={goReview}
              >
                {preview.isPending ? "Building preview…" : "Review"}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function TradeCard({
  template,
  checked,
  applied,
  single,
  onChange,
}: {
  template: WorkflowTemplateOption;
  checked: boolean;
  applied: boolean;
  /** Radio semantics: exactly one may be picked. */
  single?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "cursor-pointer rounded-md border p-3 text-sm transition-colors",
        checked ? "border-brand bg-brand/5" : "hover:bg-gray-50",
        applied && "opacity-80",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        <Checkbox
          checked={checked}
          disabled={applied}
          onCheckedChange={(v) => onChange(single ? true : Boolean(v))}
          aria-label={template.name}
        />
        {template.name}
        {template.suggested && !applied && (
          <span className="rounded-full bg-tone-info-soft px-1.5 text-[10px] font-medium text-tone-info-fg">
            suggested
          </span>
        )}
        {applied && (
          <span className="rounded-full bg-tone-success-soft px-1.5 text-[10px] font-medium text-tone-success-fg">
            applied
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {template.taskCount} steps · {template.phaseCount} phases · v
        {template.version}
      </p>
      {template.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {template.description}
        </p>
      )}
    </label>
  );
}

/** The composed plan before anything is created. Shared with the violation intake's review step. */
export function WorkflowPreviewPanel({
  preview,
  users,
}: {
  preview: WorkflowPreviewData;
  users: { id: string; firstName: string; lastName: string }[];
}) {
  const name = (id: string | null) => {
    const u = id ? users.find((x) => x.id === id) : null;
    return u ? `${u.firstName} ${u.lastName}`.trim() : "Unassigned";
  };
  const waiting = preview.tasks.filter((t) => !t.initiallyActive && !t.exists);
  const active = preview.tasks.filter((t) => t.initiallyActive && !t.exists);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label="Modules"
          value={preview.modules.map((m) => m.name).join(" + ")}
          small
        />
        <Tile label="Phases" value={String(preview.counts.phases)} />
        <Tile
          label="Tasks to create"
          value={String(preview.counts.toCreate)}
          hint={
            preview.counts.existing > 0
              ? `${preview.counts.existing} already exist`
              : undefined
          }
        />
        <Tile
          label="Estimated duration"
          value={
            preview.estimatedBusinessDays > 0
              ? `~${preview.estimatedBusinessDays} business days`
              : "—"
          }
          hint="critical path"
        />
      </div>

      {preview.unassignedRoles.length > 0 && (
        <Callout
          tone="warning"
          title={`${preview.unassignedRoles.length} role${preview.unassignedRoles.length === 1 ? "" : "s"} resolve to nobody`}
        >
          {preview.unassignedRoles
            .map((r) => WORKFLOW_ROLE_LABEL[r])
            .join(", ")}{" "}
          — their steps will be created unassigned and flagged on the Workflow
          tab. Pick people in the Team section, or set company defaults in
          Admin.
        </Callout>
      )}
      {preview.potentialDuplicates.length > 0 && (
        <Callout
          tone="info"
          title={`${preview.potentialDuplicates.length} existing task${preview.potentialDuplicates.length === 1 ? " has" : "s have"} the same title`}
        >
          Both will be kept:{" "}
          {preview.potentialDuplicates
            .slice(0, 3)
            .map((d) => `“${d.title}”`)
            .join(", ")}
          {preview.potentialDuplicates.length > 3
            ? ` and ${preview.potentialDuplicates.length - 3} more`
            : ""}
          .
        </Callout>
      )}
      {preview.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}

      <div>
        <p className="text-xs font-medium text-muted-foreground">Roles used</p>
        <p className="mt-0.5 text-sm">
          {preview.rolesUsed.map((r) => WORKFLOW_ROLE_LABEL[r]).join(" · ")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Ready immediately ({active.length})
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {active.slice(0, 8).map((t) => (
              <li key={t.key} className="flex justify-between gap-2">
                <span className="truncate">{t.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {name(t.assigneeId)}
                  {t.dueAt ? ` · ${format(new Date(t.dueAt), "MMM d")}` : ""}
                </span>
              </li>
            ))}
            {active.length > 8 && (
              <li className="text-xs text-muted-foreground">
                and {active.length - 8} more
              </li>
            )}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Initially waiting ({waiting.length})
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {waiting.slice(0, 8).map((t) => (
              <li key={t.key} className="truncate">
                {t.blocking ? "⛔ " : ""}
                {t.title}
              </li>
            ))}
            {waiting.length > 8 && (
              <li className="text-xs">
                and {waiting.length - 8} more, activated as their predecessors
                finish
              </li>
            )}
          </ul>
        </div>
      </div>

      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Phases ({preview.phases.length})
        </summary>
        <ul className="mt-2 space-y-1">
          {preview.phases.map((p) => (
            <li key={p.key} className="flex justify-between gap-2">
              <span>
                {p.name}
                {p.moduleName !== "Core Construction" && preview.modules.length > 1 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    · {p.moduleName}
                  </span>
                )}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {p.taskCount} steps
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  small,
}: {
  label: string;
  value: string;
  hint?: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-md border bg-gray-50 p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("font-semibold", small ? "text-sm" : "text-lg")}>
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
