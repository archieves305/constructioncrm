"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/shared/callout";
import { LEGAL_NO_PERMIT_WARNING } from "@/lib/workflows/templates/types";
import { cn } from "@/lib/utils";
import { PERMIT_STATUS_LABEL } from "./status";
import { ReconcilePreviewPanel } from "./reconcile-preview-panel";
import { useReconcile, useReconcilePreview, useWorkflowTemplates } from "./use-workflow";
import { subjectInfoOf, toSubjectRef, type JobWorkflowData, type ReconcileChange, type ReconcilePlanData, type SubjectLike } from "./types";

export type ReconcileMode =
  | { kind: "permit" }
  | { kind: "add-trade" }
  | { kind: "remove-trade"; templateKey: string; name: string }
  | { kind: "scope" }
  | { kind: "upgrade"; templateKey: string; name: string; from: number; to: number; versionId: string };

/**
 * Every re-plan goes through the same two steps: describe the change, see
 * exactly what it does (To add / To skip / Kept), then confirm. The form
 * half varies by mode; the preview half is shared. Works on a job or a
 * violation case (which never offers add/remove trade).
 */
export function ReconcileDialog({ subject, data, mode, open, onOpenChange }: { subject: SubjectLike; data: JobWorkflowData; mode: ReconcileMode; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {open && <ReconcileBody subject={subject} data={data} mode={mode} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ReconcileBody({ subject, data, mode, onClose }: { subject: SubjectLike; data: JobWorkflowData; mode: ReconcileMode; onClose: () => void }) {
  const ref = toSubjectRef(subject);
  const info = subjectInfoOf(data);
  const preview = useReconcilePreview(ref);
  const apply = useReconcile(ref);
  const { data: templates = [], isLoading: loadingTemplates } = useWorkflowTemplates(ref.kind === "job" ? ref.id : undefined, { enabled: mode.kind === "add-trade", kind: "TRADE" });
  const inst = data.instance!;
  const applied = useMemo(() => new Set((data.modules ?? []).filter((m) => !m.removedAt).map((m) => m.templateKey)), [data.modules]);

  const [step, setStep] = useState<"form" | "preview">("form");
  const [plan, setPlan] = useState<ReconcilePlanData | null>(null);
  const [retain, setRetain] = useState<Set<string>>(new Set());
  // permit
  const [permitStatus, setPermitStatus] = useState<"REQUIRED" | "NOT_REQUIRED">(inst.permitStatus === "REQUIRED" ? "NOT_REQUIRED" : "REQUIRED");
  const [reason, setReason] = useState("");
  const [jurisdiction, setJurisdiction] = useState(info.jurisdiction ?? "");
  // add-trade
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toggles, setToggles] = useState<Record<string, Record<string, boolean>>>({});
  // scope
  const [scope, setScope] = useState<Record<string, Record<string, boolean>>>(() => Object.fromEntries((data.toggles ?? []).map((m) => [m.moduleKey, { ...m.values }])));

  const change = (): ReconcileChange => {
    switch (mode.kind) {
      case "permit":
        return { kind: "permit", status: permitStatus, reason: reason.trim() || null, jurisdiction: jurisdiction.trim() || null };
      case "add-trade":
        return { kind: "add-module", templateKeys: Array.from(selected), scopeToggles: Object.fromEntries(Array.from(selected).map((k) => [k, toggles[k] ?? {}])) };
      case "remove-trade":
        return { kind: "remove-module", templateKey: mode.templateKey, reason: reason.trim(), retainTaskIds: Array.from(retain) };
      case "scope":
        return { kind: "scope", scopeToggles: scope };
      case "upgrade":
        return { kind: "upgrade-module", templateKey: mode.templateKey, versionId: mode.versionId };
    }
  };

  const formValid =
    mode.kind === "permit" ? !(inst.permitStatus === "REQUIRED" && permitStatus === "NOT_REQUIRED" && !reason.trim())
    : mode.kind === "add-trade" ? selected.size > 0
    : mode.kind === "remove-trade" ? reason.trim().length > 0
    : true;

  async function goPreview() {
    const p = await preview.mutateAsync(change());
    setPlan(p);
    setStep("preview");
  }
  async function confirm() {
    await apply.mutateAsync(change());
    onClose();
  }

  const title =
    mode.kind === "permit" ? "Change permit status"
    : mode.kind === "add-trade" ? "Add a trade"
    : mode.kind === "remove-trade" ? `Remove ${mode.name}`
    : mode.kind === "scope" ? "Change scope"
    : `Upgrade ${mode.name} to v${mode.to}`;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{step === "form" ? title : `Review — ${title.toLowerCase()}`}</DialogTitle>
        <DialogDescription>
          {step === "form"
            ? "Nothing changes until you confirm on the next screen."
            : "Confirm to re-plan the workflow. Completed and manual tasks are never touched."}
        </DialogDescription>
      </DialogHeader>

      {step === "form" && mode.kind === "permit" && (
        <div className="space-y-3">
          <p className="text-sm">
            Currently: <strong>{PERMIT_STATUS_LABEL[inst.permitStatus]}</strong>
          </p>
          <RadioGroup value={permitStatus} onValueChange={(v) => setPermitStatus(v as "REQUIRED" | "NOT_REQUIRED")} className="gap-1.5">
            {(["REQUIRED", "NOT_REQUIRED"] as const)
              .filter((s) => s !== inst.permitStatus)
              .map((s) => (
                <label key={s} className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm", permitStatus === s && "border-brand bg-brand/5")}>
                  <RadioGroupItem value={s} className="mt-0.5" aria-label={PERMIT_STATUS_LABEL[s]} />
                  <span>
                    <span className="font-medium">{PERMIT_STATUS_LABEL[s]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s === "REQUIRED" ? "Adds the permit steps back; open no-permit steps are skipped." : "Skips the open permit steps and adds the no-permit documentation and PM approval."}
                    </span>
                  </span>
                </label>
              ))}
          </RadioGroup>
          {permitStatus === "NOT_REQUIRED" && (
            <Callout tone="warning" title="Before you choose this">
              {LEGAL_NO_PERMIT_WARNING}
            </Callout>
          )}
          <div>
            <Label htmlFor="rc-reason" className="text-xs">
              Reason {permitStatus === "NOT_REQUIRED" ? "(required)" : "(optional)"}
            </Label>
            <Textarea id="rc-reason" rows={2} className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={permitStatus === "NOT_REQUIRED" ? "Who confirmed the exemption, and how" : "What changed"} />
          </div>
          <div>
            <Label htmlFor="rc-jur" className="text-xs">
              Jurisdiction
            </Label>
            <Input id="rc-jur" className="mt-1" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
          </div>
        </div>
      )}

      {step === "form" && mode.kind === "add-trade" && (
        <div className="space-y-4">
          {loadingTemplates ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {templates
                .filter((t) => t.kind === "TRADE" && !applied.has(t.key))
                .map((t) => (
                  <label key={t.key} className={cn("cursor-pointer rounded-md border p-3 text-sm", selected.has(t.key) && "border-brand bg-brand/5")}>
                    <div className="flex items-center gap-2 font-medium">
                      <Checkbox
                        checked={selected.has(t.key)}
                        onCheckedChange={(v) => {
                          setSelected((s) => {
                            const n = new Set(s);
                            if (v) n.add(t.key);
                            else n.delete(t.key);
                            return n;
                          });
                          if (v && !toggles[t.key]) setToggles((all) => ({ ...all, [t.key]: Object.fromEntries(t.scopeToggles.map((s) => [s.key, s.default])) }));
                        }}
                        aria-label={t.name}
                      />
                      {t.name}
                      {t.suggested && <span className="rounded-full bg-tone-info-soft px-1.5 text-[10px] text-tone-info-fg">suggested</span>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.taskCount} steps · v{t.version}
                    </p>
                  </label>
                ))}
              {templates.filter((t) => t.kind === "TRADE" && !applied.has(t.key)).length === 0 && <p className="text-sm text-muted-foreground">Every published trade is already on this job.</p>}
            </div>
          )}
          {templates
            .filter((t) => selected.has(t.key) && t.scopeToggles.length > 0)
            .map((t) => (
              <div key={t.key}>
                <Label className="text-xs">{t.name} — scope</Label>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
                  {t.scopeToggles.map((s) => (
                    <label key={s.key} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={toggles[t.key]?.[s.key] ?? s.default} onCheckedChange={(v) => setToggles((all) => ({ ...all, [t.key]: { ...all[t.key], [s.key]: Boolean(v) } }))} aria-label={s.label} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {step === "form" && mode.kind === "remove-trade" && (
        <div className="space-y-3">
          <Callout tone="warning" title={`Open ${mode.name} steps will be skipped`}>
            Completed steps stay on the job. On the next screen you can keep individual open steps instead of skipping them. Core steps that {mode.name} had replaced come back.
          </Callout>
          <div>
            <Label htmlFor="rm-reason" className="text-xs">
              Why is {mode.name} coming off this job?
            </Label>
            <Textarea id="rm-reason" rows={2} className="mt-1" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner is using a separate roofer" />
          </div>
        </div>
      )}

      {step === "form" && mode.kind === "scope" && (
        <div className="space-y-4">
          {(data.toggles ?? []).map((m) => (
            <div key={m.moduleKey}>
              <Label className="text-xs">{m.name}</Label>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
                {m.toggles.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={scope[m.moduleKey]?.[s.key] ?? s.default} onCheckedChange={(v) => setScope((all) => ({ ...all, [m.moduleKey]: { ...all[m.moduleKey], [s.key]: Boolean(v) } }))} aria-label={s.label} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Turning a toggle off skips its open steps (with the reason on their timeline); turning it on adds or reinstates them.</p>
        </div>
      )}

      {step === "form" && mode.kind === "upgrade" && (
        <Callout tone="info" title={`${mode.name} v${mode.from} → v${mode.to}`}>
          New steps in v{mode.to} are added, steps that no longer exist are skipped, and existing tasks keep their titles. The preview lists everything.
        </Callout>
      )}

      {step === "preview" && plan && (
        <ReconcilePreviewPanel
          plan={plan}
          retain={mode.kind === "remove-trade" ? retain : undefined}
          onRetainChange={
            mode.kind === "remove-trade"
              ? (id, keep) =>
                  setRetain((r) => {
                    const n = new Set(r);
                    if (keep) n.add(id);
                    else n.delete(id);
                    return n;
                  })
              : undefined
          }
        />
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-muted-foreground">{step === "form" ? "Step 1 of 2" : "Step 2 of 2"}</span>
        <div className="flex gap-2">
          {step === "preview" ? (
            <>
              <Button variant="ghost" onClick={() => setStep("form")}>
                Back
              </Button>
              <Button variant="brand" disabled={apply.isPending} onClick={confirm}>
                {apply.isPending ? "Re-planning…" : "Confirm — re-plan workflow"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!formValid || preview.isPending} onClick={goPreview}>
                {preview.isPending ? "Building preview…" : "Preview changes"}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
