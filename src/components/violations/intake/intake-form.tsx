"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { PageHeader } from "@/components/shared/page-header";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { WorkflowPreviewPanel } from "@/components/workflows/apply-workflow-dialog";
import { useWorkflowTemplates } from "@/components/workflows/use-workflow";
import type { WorkflowPreviewData } from "@/components/workflows/types";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { LEGAL_NO_PERMIT_WARNING } from "@/lib/workflows/templates/types";
import { WORKFLOW_ROLE_LABEL, WORKFLOW_ROLES } from "@/lib/workflows/role-labels";
import { toggleDefaultsFromIntake } from "@/lib/violations/intake";
import { cn } from "@/lib/utils";
import { NOTICE_TYPE_LABEL, SEVERITY_LABEL } from "../status";
import { useCreateCase, useViolationCategories, type Category } from "../use-violations";
import { LeadPicker, type PickedLead } from "./lead-picker";

const STEPS = ["Property", "Notice", "Violations", "Assessment", "Review"] as const;

type ItemDraft = { key: string; categoryId: string; codeSection: string; description: string; correctiveAction: string; responsibleTrade: string; permitRequirement: "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED"; targetCompletionAt: string; estimatedCost: string };
type Form = {
  lead: PickedLead | null;
  jobId: string | null;
  parcelNumber: string;
  ownerNameSnapshot: string;
  title: string;
  agencyCaseNumber: string;
  jurisdiction: string;
  department: string;
  officerName: string;
  officerPhone: string;
  officerEmail: string;
  noticeType: string;
  noticeDate: string;
  receivedAt: string;
  complianceDeadline: string;
  appealDeadline: string;
  summary: string;
  items: ItemDraft[];
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  severity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  caseManagerId: string | null;
  responsibleRole: string;
  team: Record<string, string | null>;
  permitStatus: "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED";
  permitNotes: string;
  hearingRequired: boolean;
  hearingAt: string;
  hearingLocation: string;
  reinspectionRequired: boolean;
  emergency: boolean;
  constructionRequired: boolean | null;
  appeal: boolean;
  initialFine: string;
  dailyFine: string;
  accrualStartDate: string;
  lienRecorded: boolean;
  lienAmount: string;
  lienRecordedAt: string;
  lienInstrumentNumber: string;
  estimatedCost: string;
  templateKey: string | null;
  scopeToggles: Record<string, boolean>;
  touchedToggles: boolean;
};

const DRAFT_KEY = "violations:intake-draft";

function blankItem(): ItemDraft {
  return { key: Math.random().toString(36).slice(2), categoryId: "", codeSection: "", description: "", correctiveAction: "", responsibleTrade: "", permitRequirement: "UNDETERMINED", targetCompletionAt: "", estimatedCost: "" };
}

function initial(prefill: { leadId?: string | null; jobId?: string | null }): Form {
  return {
    lead: null,
    jobId: prefill.jobId ?? null,
    parcelNumber: "",
    ownerNameSnapshot: "",
    title: "",
    agencyCaseNumber: "",
    jurisdiction: "",
    department: "",
    officerName: "",
    officerPhone: "",
    officerEmail: "",
    noticeType: "NOTICE_OF_VIOLATION",
    noticeDate: "",
    receivedAt: new Date().toISOString().slice(0, 10),
    complianceDeadline: "",
    appealDeadline: "",
    summary: "",
    items: [],
    priority: "MEDIUM",
    severity: "MODERATE",
    caseManagerId: null,
    responsibleRole: "",
    team: {},
    permitStatus: "UNDETERMINED",
    permitNotes: "",
    hearingRequired: false,
    hearingAt: "",
    hearingLocation: "",
    reinspectionRequired: true,
    emergency: false,
    constructionRequired: null,
    appeal: false,
    initialFine: "",
    dailyFine: "",
    accrualStartDate: "",
    lienRecorded: false,
    lienAmount: "",
    lienRecordedAt: "",
    lienInstrumentNumber: "",
    estimatedCost: "",
    templateKey: null,
    scopeToggles: {},
    touchedToggles: false,
  };
}

/**
 * Five steps, one page. The draft survives a round-trip to "create a new
 * lead" via sessionStorage; the case is created in one POST and the
 * workflow applied right after (the review step shows what that generates).
 */
export function IntakeForm({ prefill, returnedLeadId }: { prefill: { leadId?: string | null; jobId?: string | null }; returnedLeadId: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(() => initial(prefill));
  const [restored, setRestored] = useState(false);
  const { data: categories = [] } = useViolationCategories();
  const { data: users = [] } = useAssignableUsers();
  const { data: templates = [], isLoading: loadingTemplates } = useWorkflowTemplates(undefined, { kind: "VIOLATION" });
  const create = useCreateCase();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Restore a draft after the "create a new lead" round trip.
  useEffect(() => {
    if (restored) return;
    setRestored(true);
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { form: Form; step: number };
        setForm(saved.form);
        setStep(saved.step);
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // no draft
    }
  }, [restored]);

  // A lead id in the URL (from a Lead page, a Job page or a fresh lead) resolves to the picked property.
  const wantLeadId = returnedLeadId ?? prefill.leadId ?? null;
  const { data: prefillLead } = useQuery<PickedLead>({ queryKey: ["lead", wantLeadId, "picker"], queryFn: () => fetchJson(`/api/leads/${wantLeadId}`), enabled: Boolean(wantLeadId) && !form.lead, retry: retryServerErrors });
  useEffect(() => {
    if (prefillLead && !form.lead) setForm((f) => ({ ...f, lead: prefillLead, ownerNameSnapshot: f.ownerNameSnapshot || prefillLead.fullName }));
  }, [prefillLead, form.lead]);

  // Default template = the first published violation template.
  useEffect(() => {
    if (!form.templateKey && templates.length > 0) set("templateKey", templates[0]!.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.length]);

  const template = templates.find((t) => t.key === form.templateKey) ?? null;
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const intakeDefaults = useMemo(
    () =>
      toggleDefaultsFromIntake({
        categories: form.items.flatMap((i) => (i.categoryId && catById.get(i.categoryId) ? [{ key: catById.get(i.categoryId)!.key, defaultConstructionRequired: catById.get(i.categoryId)!.defaultConstructionRequired, defaultPermitRequirement: catById.get(i.categoryId)!.defaultPermitRequirement }] : [])),
        hearingDate: form.hearingAt ? new Date(form.hearingAt) : null,
        hearingRequired: form.hearingRequired || undefined,
        dailyFine: form.dailyFine ? Number(form.dailyFine) : null,
        initialFine: form.initialFine ? Number(form.initialFine) : null,
        lienRecorded: form.lienRecorded,
        emergency: form.emergency,
        constructionRequired: form.constructionRequired,
        appeal: form.appeal,
      }),
    [form, catById],
  );
  // The toggles follow the answers until the person edits them by hand.
  const effectiveToggles = useMemo(() => {
    const base: Record<string, boolean> = {};
    for (const t of template?.scopeToggles ?? []) base[t.key] = intakeDefaults.scopeToggles[t.key] ?? t.default;
    return form.touchedToggles ? { ...base, ...form.scopeToggles } : base;
  }, [template, intakeDefaults, form.touchedToggles, form.scopeToggles]);

  const preview = useMutation({
    mutationFn: (body: unknown) => fetchJson<WorkflowPreviewData>("/api/violations/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  useEffect(() => {
    if (step === 4 && form.templateKey) {
      preview.mutate({ templateKey: form.templateKey, permitStatus: form.permitStatus, scopeToggles: effectiveToggles, caseManagerId: form.caseManagerId, team: form.team });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const stepError = (i: number): string | null => {
    if (i === 0 && !form.lead) return "Pick the property (a lead) first.";
    if (i === 1) {
      if (!form.title.trim()) return "Give the case a title.";
      if (!form.receivedAt) return "When was the notice received?";
    }
    if (i === 2) {
      if (form.items.length === 0) return "Add at least one violation item.";
      if (form.items.some((it) => !it.description.trim())) return "Every item needs a description.";
    }
    if (i === 3) {
      if (form.dailyFine && Number(form.dailyFine) > 0 && !form.accrualStartDate) return "A daily fine needs an accrual start date.";
      if (form.permitStatus === "NOT_REQUIRED" && form.permitNotes.trim().length < 10) return "Say why no permit is required (this is recorded with the legal warning).";
      if (form.hearingRequired && !form.hearingAt) return "Enter the hearing date, or untick “hearing required”.";
    }
    return null;
  };
  const currentError = stepError(step);
  const canNext = !currentError;

  const submit = () => {
    if (!form.lead) return;
    const body = {
      leadId: form.lead.id,
      jobId: form.jobId,
      parcelNumber: form.parcelNumber.trim() || null,
      ownerNameSnapshot: form.ownerNameSnapshot.trim() || null,
      title: form.title.trim(),
      agencyCaseNumber: form.agencyCaseNumber.trim() || null,
      jurisdiction: form.jurisdiction.trim() || null,
      department: form.department.trim() || null,
      officerName: form.officerName.trim() || null,
      officerPhone: form.officerPhone.trim() || null,
      officerEmail: form.officerEmail.trim() || null,
      noticeType: form.noticeType || null,
      noticeDate: form.noticeDate || null,
      receivedAt: form.receivedAt,
      complianceDeadline: form.complianceDeadline || null,
      appealDeadline: form.appealDeadline || null,
      summary: form.summary.trim() || null,
      priority: form.priority,
      severity: form.severity,
      caseManagerId: form.caseManagerId,
      responsibleRole: form.responsibleRole || null,
      hearingRequired: form.hearingRequired,
      hearingAt: form.hearingAt ? new Date(form.hearingAt).toISOString() : null,
      hearingLocation: form.hearingLocation.trim() || null,
      reinspectionRequired: form.reinspectionRequired,
      emergency: form.emergency,
      constructionRequired: intakeDefaults.constructionRequired,
      estimatedCost: form.estimatedCost.trim() || null,
      items: form.items.map((it) => ({
        categoryId: it.categoryId || null,
        codeSection: it.codeSection.trim() || null,
        description: it.description.trim(),
        correctiveAction: it.correctiveAction.trim() || null,
        responsibleTrade: it.responsibleTrade.trim() || null,
        permitRequirement: it.permitRequirement,
        targetCompletionAt: it.targetCompletionAt || null,
        estimatedCost: it.estimatedCost.trim() || null,
      })),
      fines: { initialFine: form.initialFine.trim() || null, dailyFine: form.dailyFine.trim() || null, accrualStartDate: form.accrualStartDate || null },
      lien: form.lienRecorded ? { recorded: true, recordedAt: form.lienRecordedAt || null, amount: form.lienAmount.trim() || null, instrumentNumber: form.lienInstrumentNumber.trim() || null } : { recorded: false },
      workflow: { templateKey: form.templateKey, permitStatus: form.permitStatus, scopeToggles: effectiveToggles, team: form.team, permitNotes: form.permitNotes.trim() || null },
    };
    create.mutate(body, { onSuccess: (r) => router.push(`/violations/${r.id}`) });
  };

  const returnTo = `/violations/new`;
  const stash = () => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step }));
    } catch {
      // nothing to do
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New code violation case" description="From the notice in hand to a case with its items, deadline and generated workflow." />
      <ol className="mb-6 flex flex-wrap gap-1">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={i > step && Boolean(stepError(step))}
              onClick={() => i < step && setStep(i)}
              className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", i === step ? "border-brand bg-brand-soft text-brand-fg" : i < step ? "border-transparent text-gray-700 hover:bg-gray-50" : "border-transparent text-muted-foreground")}
            >
              <span className={cn("flex size-4 items-center justify-center rounded-full text-[10px]", i < step ? "bg-brand text-white" : i === step ? "bg-brand/20" : "bg-gray-100")}>{i < step ? <Check className="size-2.5" /> : i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <>
              <div onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a[href*='/leads/new']")) stash(); }}>
                <LeadPicker value={form.lead} onChange={(l) => setForm((f) => ({ ...f, lead: l, ownerNameSnapshot: f.ownerNameSnapshot || l.fullName }))} returnTo={returnTo} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Parcel / folio number</Label>
                  <Input className="mt-1" value={form.parcelNumber} onChange={(e) => set("parcelNumber", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Owner as printed on the notice</Label>
                  <Input className="mt-1" value={form.ownerNameSnapshot} onChange={(e) => set("ownerNameSnapshot", e.target.value)} />
                </div>
              </div>
              {form.lead && <JobPickerRow leadId={form.lead.id} value={form.jobId} onChange={(v) => set("jobId", v)} />}
            </>
          )}

          {step === 1 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">Case title</Label>
                <Input className="mt-1" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Unpermitted roof replacement — 123 Main St" />
              </div>
              <div>
                <Label className="text-xs">Notice type</Label>
                <Select value={form.noticeType} onValueChange={(v: string | null) => v && set("noticeType", v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue>{(v: string) => NOTICE_TYPE_LABEL[v] ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(NOTICE_TYPE_LABEL).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Agency case / citation #</Label>
                <Input className="mt-1" value={form.agencyCaseNumber} onChange={(e) => set("agencyCaseNumber", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Jurisdiction (city / county)</Label>
                <Input className="mt-1" value={form.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value)} placeholder={form.lead?.county ? `${form.lead.county} County` : ""} />
              </div>
              <div>
                <Label className="text-xs">Department</Label>
                <Input className="mt-1" value={form.department} onChange={(e) => set("department", e.target.value)} placeholder="Code Enforcement, Building…" />
              </div>
              <div>
                <Label className="text-xs">Code officer</Label>
                <Input className="mt-1" value={form.officerName} onChange={(e) => set("officerName", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Officer phone</Label>
                <Input className="mt-1" value={form.officerPhone} onChange={(e) => set("officerPhone", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Officer email</Label>
                <Input className="mt-1" value={form.officerEmail} onChange={(e) => set("officerEmail", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Notice date</Label>
                <Input type="date" className="mt-1" value={form.noticeDate} onChange={(e) => set("noticeDate", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Received on</Label>
                <Input type="date" className="mt-1" value={form.receivedAt} onChange={(e) => set("receivedAt", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Compliance deadline</Label>
                <Input type="date" className="mt-1" value={form.complianceDeadline} onChange={(e) => set("complianceDeadline", e.target.value)} />
                <p className="mt-0.5 text-[11px] text-muted-foreground">The workflow&apos;s deadline-anchored steps are dated from this.</p>
              </div>
              <div>
                <Label className="text-xs">Appeal deadline</Label>
                <Input type="date" className="mt-1" value={form.appealDeadline} onChange={(e) => set("appealDeadline", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Summary of the notice</Label>
                <Textarea className="mt-1" rows={3} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Tap a category to add an item for it</p>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => set("items", [...form.items, { ...blankItem(), categoryId: c.id, responsibleTrade: c.defaultResponsibleTrade ?? "", permitRequirement: c.defaultPermitRequirement }])}
                      className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-gray-50"
                    >
                      + {c.name}
                    </button>
                  ))}
                  <button type="button" onClick={() => set("items", [...form.items, blankItem()])} className="rounded-full border border-dashed px-2.5 py-0.5 text-xs hover:bg-gray-50">
                    <Plus className="mr-0.5 inline size-3" /> Other
                  </button>
                </div>
              </div>
              {form.items.length === 0 ? (
                <Callout tone="neutral">One item per violation cited on the notice. Each becomes its own line with its trade, permit need and cost.</Callout>
              ) : (
                <ol className="space-y-3">
                  {form.items.map((it, i) => (
                    <li key={it.key} className="rounded-lg border p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">Item {i + 1}</span>
                        <Select value={it.categoryId || "__none"} onValueChange={(v: string | null) => updateItem(i, { categoryId: !v || v === "__none" ? "" : v })}>
                          <SelectTrigger className="h-8 w-56 text-xs">
                            <SelectValue>{(v: string) => (!v || v === "__none" ? "No category" : (catById.get(v)?.name ?? "—"))}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">No category</SelectItem>
                            {categories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button type="button" className="ml-auto rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-destructive" onClick={() => set("items", form.items.filter((_, j) => j !== i))} title="Remove item">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <Textarea rows={2} value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} placeholder="The violation as cited on the notice" />
                        </div>
                        <Input value={it.codeSection} onChange={(e) => updateItem(i, { codeSection: e.target.value })} placeholder="Code section" />
                        <Input value={it.correctiveAction} onChange={(e) => updateItem(i, { correctiveAction: e.target.value })} placeholder="Required corrective action" />
                        <Input value={it.responsibleTrade} onChange={(e) => updateItem(i, { responsibleTrade: e.target.value })} placeholder="Responsible trade" />
                        <Select value={it.permitRequirement} onValueChange={(v: string | null) => v && updateItem(i, { permitRequirement: v as ItemDraft["permitRequirement"] })}>
                          <SelectTrigger className="text-xs">
                            <SelectValue>{(v: string) => (v === "REQUIRED" ? "Permit required" : v === "NOT_REQUIRED" ? "No permit" : "Permit undetermined")}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="UNDETERMINED">Permit undetermined</SelectItem>
                            <SelectItem value="REQUIRED">Permit required</SelectItem>
                            <SelectItem value="NOT_REQUIRED">No permit</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input type="date" value={it.targetCompletionAt} onChange={(e) => updateItem(i, { targetCompletionAt: e.target.value })} />
                        <Input inputMode="decimal" value={it.estimatedCost} onChange={(e) => updateItem(i, { estimatedCost: e.target.value })} placeholder="Estimated cost" />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <section className="space-y-2">
                <Label className="text-xs">Permit</Label>
                <RadioGroup value={form.permitStatus} onValueChange={(v) => set("permitStatus", v as Form["permitStatus"])} className="gap-1.5">
                  {(
                    [
                      ["UNDETERMINED", "Undetermined", "Keep the permit branch waiting until someone decides."],
                      ["REQUIRED", "Permit required", `Nine permit steps from application to final — ${intakeDefaults.permitSuggestion === "REQUIRED" ? "suggested by the categories" : "when the work needs one"}.`],
                      ["NOT_REQUIRED", "No permit required", "Records the legal warning and needs the PM's approval before mobilizing."],
                    ] as const
                  ).map(([v, l, d]) => (
                    <label key={v} className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm", form.permitStatus === v && "border-brand bg-brand/5")}>
                      <RadioGroupItem value={v} aria-label={l} className="mt-0.5" />
                      <span>
                        <span className="font-medium">{l}</span>
                        <span className="block text-xs text-muted-foreground">{d}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
                {form.permitStatus === "NOT_REQUIRED" && (
                  <>
                    <Callout tone="warning">{LEGAL_NO_PERMIT_WARNING}</Callout>
                    <Textarea rows={2} value={form.permitNotes} onChange={(e) => set("permitNotes", e.target.value)} placeholder="Why no permit is required (recorded on the case)" />
                  </>
                )}
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={intakeDefaults.constructionRequired} onCheckedChange={(v) => set("constructionRequired", Boolean(v))} /> Corrective construction required
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.reinspectionRequired} onCheckedChange={(v) => set("reinspectionRequired", Boolean(v))} /> Reinspection required
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.emergency} onCheckedChange={(v) => set("emergency", Boolean(v))} /> Emergency / unsafe condition
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.appeal} onCheckedChange={(v) => set("appeal", Boolean(v))} /> We intend to appeal
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.hearingRequired} onCheckedChange={(v) => set("hearingRequired", Boolean(v))} /> Hearing scheduled / required
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.lienRecorded} onCheckedChange={(v) => set("lienRecorded", Boolean(v))} /> A lien is already recorded
                </label>
              </section>

              {form.hearingRequired && (
                <section className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Hearing date and time</Label>
                    <Input type="datetime-local" className="mt-1" value={form.hearingAt} onChange={(e) => set("hearingAt", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Location</Label>
                    <Input className="mt-1" value={form.hearingLocation} onChange={(e) => set("hearingLocation", e.target.value)} />
                  </div>
                </section>
              )}

              <section className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Initial fine</Label>
                  <Input className="mt-1" inputMode="decimal" value={form.initialFine} onChange={(e) => set("initialFine", e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <Label className="text-xs">Daily fine</Label>
                  <Input className="mt-1" inputMode="decimal" value={form.dailyFine} onChange={(e) => set("dailyFine", e.target.value)} placeholder="0.00 / day" />
                </div>
                <div>
                  <Label className="text-xs">Accrual starts</Label>
                  <Input type="date" className="mt-1" value={form.accrualStartDate} onChange={(e) => set("accrualStartDate", e.target.value)} />
                </div>
              </section>
              {form.lienRecorded && (
                <section className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">Lien amount</Label>
                    <Input className="mt-1" inputMode="decimal" value={form.lienAmount} onChange={(e) => set("lienAmount", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Recorded on</Label>
                    <Input type="date" className="mt-1" value={form.lienRecordedAt} onChange={(e) => set("lienRecordedAt", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Instrument #</Label>
                    <Input className="mt-1" value={form.lienInstrumentNumber} onChange={(e) => set("lienInstrumentNumber", e.target.value)} />
                  </div>
                </section>
              )}

              <section className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Priority</Label>
                  <Select value={form.priority} onValueChange={(v: string | null) => v && set("priority", v as Form["priority"])}>
                    <SelectTrigger className="mt-1">
                      <SelectValue>{(v: string) => v.charAt(0) + v.slice(1).toLowerCase()}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                        <SelectItem key={p} value={p}>
                          {p.charAt(0) + p.slice(1).toLowerCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Severity</Label>
                  <Select value={form.severity} onValueChange={(v: string | null) => v && set("severity", v as Form["severity"])}>
                    <SelectTrigger className="mt-1">
                      <SelectValue>{(v: string) => SEVERITY_LABEL[v] ?? v}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SEVERITY_LABEL).map(([k, l]) => (
                        <SelectItem key={k} value={k}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Case manager</Label>
                  <AssigneePicker className="mt-1 w-full" value={form.caseManagerId} users={users} onChange={(id) => set("caseManagerId", id)} />
                </div>
                <div>
                  <Label className="text-xs">Responsible team</Label>
                  <Select value={form.responsibleRole || "__none"} onValueChange={(v: string | null) => set("responsibleRole", !v || v === "__none" ? "" : v)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue>{(v: string) => (!v || v === "__none" ? "—" : (WORKFLOW_ROLE_LABEL[v as keyof typeof WORKFLOW_ROLE_LABEL] ?? v))}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      {WORKFLOW_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {WORKFLOW_ROLE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Estimated correction cost (case total)</Label>
                  <Input className="mt-1" inputMode="decimal" value={form.estimatedCost} onChange={(e) => set("estimatedCost", e.target.value)} />
                </div>
              </section>

              <section className="space-y-2">
                <Label className="text-xs">Workflow template</Label>
                {loadingTemplates ? (
                  <Skeleton className="h-10" />
                ) : templates.length === 0 ? (
                  <Callout tone="warning">No published violation template. The case will be created without a workflow; apply one later from its Workflow tab.</Callout>
                ) : (
                  <>
                    <Select value={form.templateKey ?? ""} onValueChange={(v: string | null) => set("templateKey", v || null)}>
                      <SelectTrigger>
                        <SelectValue>{(v: string) => templates.find((t) => t.key === v)?.name ?? "Pick a template"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => (
                          <SelectItem key={t.key} value={t.key}>
                            {t.name} · v{t.version} · {t.taskCount} steps
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {template && template.scopeToggles.length > 0 && (
                      <div className="grid gap-1.5 rounded-md border p-3 sm:grid-cols-2">
                        <p className="text-xs text-muted-foreground sm:col-span-2">Scope — set from your answers above; change any by hand.</p>
                        {template.scopeToggles.map((t) => (
                          <label key={t.key} className="flex items-start gap-2 text-sm">
                            <Checkbox className="mt-0.5" checked={effectiveToggles[t.key] ?? false} onCheckedChange={(v) => setForm((f) => ({ ...f, touchedToggles: true, scopeToggles: { ...effectiveToggles, ...f.scopeToggles, [t.key]: Boolean(v) } }))} />
                            <span>
                              {t.label}
                              {t.description && <span className="block text-xs text-muted-foreground">{t.description}</span>}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    <TeamSlots templateRoles={WORKFLOW_ROLES.filter((r) => r !== "CASE_MANAGER")} users={users} value={form.team} onChange={(v) => set("team", v)} />
                  </>
                )}
              </section>
            </div>
          )}

          {step === 4 && form.lead && (
            <div className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Summary label="Property" value={`${form.lead.propertyAddress1}, ${form.lead.city} · ${form.lead.fullName}`} />
                <Summary label="Case" value={form.title} />
                <Summary label="Notice" value={`${NOTICE_TYPE_LABEL[form.noticeType] ?? form.noticeType}${form.agencyCaseNumber ? ` · ${form.agencyCaseNumber}` : ""}${form.jurisdiction ? ` · ${form.jurisdiction}` : ""}`} />
                <Summary label="Deadline" value={form.complianceDeadline ? format(new Date(`${form.complianceDeadline}T12:00:00`), "MMM d, yyyy") : "Not set"} />
                <Summary label="Items" value={`${form.items.length} — ${Array.from(new Set(form.items.map((i) => catById.get(i.categoryId)?.name).filter(Boolean))).join(", ") || "uncategorised"}`} />
                <Summary label="Permit" value={form.permitStatus === "REQUIRED" ? "Required" : form.permitStatus === "NOT_REQUIRED" ? "Not required (warning recorded)" : "Undetermined"} />
                <Summary label="Fines" value={form.dailyFine ? `${form.dailyFine}/day from ${form.accrualStartDate}` : form.initialFine ? `Initial ${form.initialFine}` : "None entered"} />
                <Summary label="Case manager" value={(() => { const u = users.find((x) => x.id === form.caseManagerId); return u ? `${u.firstName} ${u.lastName}` : "Unassigned"; })()} />
              </div>
              {!form.templateKey ? (
                <Callout tone="warning">No workflow will be applied.</Callout>
              ) : preview.isPending ? (
                <Skeleton className="h-48" />
              ) : preview.error ? (
                <Callout tone="danger" title="Couldn't preview the workflow">{preview.error.message}</Callout>
              ) : preview.data ? (
                <WorkflowPreviewPanel preview={preview.data} users={users} />
              ) : null}
            </div>
          )}

          {currentError && step < 4 && <p className="text-xs text-tone-warning-fg">{currentError}</p>}
          <div className="flex items-center justify-between border-t pt-4">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              <ChevronLeft className="size-4" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="brand" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                Next <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button variant="brand" disabled={create.isPending || Boolean(stepError(0) || stepError(1) || stepError(2) || stepError(3))} onClick={submit}>
                {create.isPending ? "Creating…" : "Create case"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  function updateItem(i: number, patch: Partial<ItemDraft>) {
    setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  }
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function JobPickerRow({ leadId, value, onChange }: { leadId: string; value: string | null; onChange: (v: string | null) => void }) {
  const { data } = useQuery<{ data: { id: string; jobNumber: string; title: string }[] }>({ queryKey: ["jobs", "for-case", leadId], queryFn: () => fetchJson(`/api/jobs?leadId=${leadId}&pageSize=100`), retry: retryServerErrors });
  const jobs = data?.data ?? [];
  if (jobs.length === 0) return null;
  return (
    <div>
      <Label className="text-xs">Corrective job on this property (optional)</Label>
      <Select value={value ?? "__none"} onValueChange={(v: string | null) => onChange(!v || v === "__none" ? null : v)}>
        <SelectTrigger className="mt-1">
          <SelectValue>{(v: string) => (!v || v === "__none" ? "No job linked yet" : (jobs.find((j) => j.id === v)?.jobNumber ?? "—"))}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">No job linked yet</SelectItem>
          {jobs.map((j) => (
            <SelectItem key={j.id} value={j.id}>
              {j.jobNumber} · {j.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TeamSlots({ templateRoles, users, value, onChange }: { templateRoles: readonly string[]; users: { id: string; firstName: string; lastName: string; isActive: boolean }[]; value: Record<string, string | null>; onChange: (v: Record<string, string | null>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border p-3">
      <button type="button" className="text-xs underline" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Set"} team slots (who fills each role on this case)
      </button>
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {templateRoles.map((r) => (
            <div key={r}>
              <Label className="text-[11px]">{WORKFLOW_ROLE_LABEL[r as keyof typeof WORKFLOW_ROLE_LABEL] ?? r}</Label>
              <AssigneePicker className="mt-0.5 w-full" size="sm" value={value[r] ?? null} users={users} onChange={(id) => onChange({ ...value, [r]: id })} placeholder="Role default" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type { Category };
