"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { GenericSectionEditor } from "@/components/estimates/generic-section-editor";
import {
  calculateGenericEstimate,
  CATEGORY_LABELS,
} from "@/lib/estimates/generic-calc";
import type { EstimateUnitType } from "@/generated/prisma/enums";
import {
  type GenericFormState,
  type FormSection,
  uid,
  emptyItem,
  num,
  money,
} from "@/components/estimates/generic-estimate-types";

export type DialogMode =
  | { kind: "create"; category: string }
  | { kind: "edit"; estimateId: string };

type TemplateResponse = {
  id: string;
  key: string;
  category: string;
  name: string;
  sections: Array<{
    title: string;
    items: Array<{
      description: string;
      unitType: EstimateUnitType;
      defaultQuantity: string | null;
      defaultUnitPrice: string | null;
      defaultNotes: string | null;
      isOptional: boolean;
    }>;
  }>;
};

type EstimateResponse = {
  id: string;
  name: string;
  templateId: string | null;
  templateCategory: string;
  marginPercent: string;
  discountEnabled: boolean;
  discountPercent: string;
  salesTaxPercent: string;
  validityDays: number;
  notes: string | null;
  exclusions: string | null;
  sections: Array<{
    title: string;
    items: Array<{
      description: string;
      unitType: EstimateUnitType;
      quantity: string;
      unitPrice: string;
      isOptional: boolean;
      notes: string | null;
    }>;
  }>;
};

function baseForm(category: string): GenericFormState {
  return {
    name: `${CATEGORY_LABELS[category] ?? "Project"} estimate`,
    templateCategory: category,
    templateId: null,
    marginPercent: "0",
    discountEnabled: false,
    discountPercent: "0",
    salesTaxPercent: "0",
    validityDays: "30",
    notes: "",
    exclusions: "",
    sections: [{ uid: uid(), title: "Section 1", items: [emptyItem()] }],
  };
}

function templateToForm(t: TemplateResponse): GenericFormState {
  const sections: FormSection[] = t.sections.map((s) => ({
    uid: uid(),
    title: s.title,
    items:
      s.items.length > 0
        ? s.items.map((i) => ({
            uid: uid(),
            description: i.description,
            unitType: i.unitType,
            quantity: i.defaultQuantity != null ? String(Number(i.defaultQuantity)) : "",
            unitPrice:
              i.defaultUnitPrice != null ? String(Number(i.defaultUnitPrice)) : "",
            isOptional: i.isOptional,
            notes: i.defaultNotes ?? "",
          }))
        : [emptyItem()],
  }));
  return {
    name: `${CATEGORY_LABELS[t.category] ?? t.name} estimate`,
    templateCategory: t.category,
    templateId: t.id,
    marginPercent: "0",
    discountEnabled: false,
    discountPercent: "0",
    salesTaxPercent: "0",
    validityDays: "30",
    notes: "",
    exclusions: "",
    sections: sections.length > 0 ? sections : baseForm(t.category).sections,
  };
}

function estimateToForm(e: EstimateResponse): GenericFormState {
  return {
    name: e.name,
    templateCategory: e.templateCategory,
    templateId: e.templateId,
    marginPercent: String(Number(e.marginPercent)),
    discountEnabled: e.discountEnabled,
    discountPercent: String(Number(e.discountPercent)),
    salesTaxPercent: String(Number(e.salesTaxPercent)),
    validityDays: String(e.validityDays),
    notes: e.notes ?? "",
    exclusions: e.exclusions ?? "",
    sections: e.sections.map((s) => ({
      uid: uid(),
      title: s.title,
      items: s.items.map((i) => ({
        uid: uid(),
        description: i.description,
        unitType: i.unitType,
        quantity: String(Number(i.quantity)),
        unitPrice: String(Number(i.unitPrice)),
        isOptional: i.isOptional,
        notes: i.notes ?? "",
      })),
    })),
  };
}

function formToPayload(form: GenericFormState) {
  return {
    templateCategory: form.templateCategory,
    templateId: form.templateId,
    name: form.name.trim(),
    sections: form.sections.map((s, sIdx) => ({
      title: s.title.trim() || `Section ${sIdx + 1}`,
      sortOrder: sIdx,
      items: s.items
        .filter((i) => i.description.trim() !== "")
        .map((i, iIdx) => ({
          description: i.description.trim(),
          unitType: i.unitType,
          quantity: num(i.quantity),
          unitPrice: num(i.unitPrice),
          isOptional: i.isOptional,
          notes: i.notes.trim() || null,
          sortOrder: iIdx,
        })),
    })),
    marginPercent: num(form.marginPercent),
    discountEnabled: form.discountEnabled,
    discountPercent: num(form.discountPercent),
    salesTaxPercent: num(form.salesTaxPercent),
    validityDays: num(form.validityDays),
    notes: form.notes.trim() || null,
    exclusions: form.exclusions.trim() || null,
  };
}

export function GenericEstimateDialog({
  leadId,
  open,
  onOpenChange,
  mode,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DialogMode | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<GenericFormState | null>(null);

  const isEdit = mode?.kind === "edit";

  // Load the template (create) or the existing estimate (edit) when opened.
  const templateQuery = useQuery<TemplateResponse>({
    queryKey: ["estimate-template", mode?.kind === "create" ? mode.category : null],
    enabled: open && mode?.kind === "create",
    queryFn: () =>
      fetch(
        `/api/estimate-templates?category=${encodeURIComponent(
          mode?.kind === "create" ? mode.category : "",
        )}`,
      ).then((r) => r.json()),
  });

  const estimateQuery = useQuery<EstimateResponse>({
    queryKey: ["template-estimate", mode?.kind === "edit" ? mode.estimateId : null],
    enabled: open && mode?.kind === "edit",
    queryFn: () =>
      fetch(
        `/api/leads/${leadId}/template-estimates/${
          mode?.kind === "edit" ? mode.estimateId : ""
        }`,
      ).then((r) => r.json()),
  });

  useEffect(() => {
    if (!open || !mode) {
      setForm(null);
      return;
    }
    if (mode.kind === "create") {
      if (templateQuery.data?.id) {
        setForm(templateToForm(templateQuery.data));
      } else if (templateQuery.isError) {
        setForm(baseForm(mode.category));
      }
    } else if (mode.kind === "edit" && estimateQuery.data?.id) {
      setForm(estimateToForm(estimateQuery.data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode?.kind, templateQuery.data, templateQuery.isError, estimateQuery.data]);

  const breakdown = useMemo(() => {
    if (!form) return null;
    return calculateGenericEstimate({
      sections: form.sections.map((s) => ({
        title: s.title,
        items: s.items.map((i) => ({
          description: i.description,
          unitType: i.unitType,
          quantity: num(i.quantity),
          unitPrice: num(i.unitPrice),
          isOptional: i.isOptional,
          notes: i.notes,
        })),
      })),
      marginPercent: num(form.marginPercent),
      discountEnabled: form.discountEnabled,
      discountPercent: num(form.discountPercent),
      salesTaxPercent: num(form.salesTaxPercent),
    });
  }, [form]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("Form not ready");
      const url =
        mode?.kind === "edit"
          ? `/api/leads/${leadId}/template-estimates/${mode.estimateId}`
          : `/api/leads/${leadId}/template-estimates`;
      const method = mode?.kind === "edit" ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(form)),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(isEdit ? "Estimate updated" : "Estimate created");
      queryClient.invalidateQueries({
        queryKey: ["lead-template-estimates", leadId],
      });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading =
    (mode?.kind === "create" && templateQuery.isLoading) ||
    (mode?.kind === "edit" && estimateQuery.isLoading) ||
    !form;

  const categoryLabel =
    CATEGORY_LABELS[form?.templateCategory ?? ""] ??
    (mode?.kind === "create" ? CATEGORY_LABELS[mode.category] : "") ??
    "Estimate";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-3xl sm:max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit" : "New"} {categoryLabel} estimate
          </DialogTitle>
        </DialogHeader>

        {loading || !form || !breakdown ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading template…
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Estimate name</Label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  placeholder="e.g., Master bath drywall"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Valid for (days)</Label>
                <Input
                  type="number"
                  value={form.validityDays}
                  onChange={(e) =>
                    setForm({ ...form, validityDays: e.target.value })
                  }
                />
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="mb-2 text-sm font-semibold">Scope by section</h3>
              <GenericSectionEditor
                sections={form.sections}
                onChange={(sections) => setForm({ ...form, sections })}
              />
            </div>

            <Separator />

            <div>
              <h3 className="mb-2 text-sm font-semibold">Pricing</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Margin %</Label>
                  <Input
                    type="number"
                    value={form.marginPercent}
                    onChange={(e) =>
                      setForm({ ...form, marginPercent: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sales tax %</Label>
                  <Input
                    type="number"
                    value={form.salesTaxPercent}
                    onChange={(e) =>
                      setForm({ ...form, salesTaxPercent: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Discount %</Label>
                  <Input
                    type="number"
                    value={form.discountPercent}
                    disabled={!form.discountEnabled}
                    onChange={(e) =>
                      setForm({ ...form, discountPercent: e.target.value })
                    }
                  />
                </div>
              </div>
              <label className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={form.discountEnabled}
                  onCheckedChange={(c) =>
                    setForm({ ...form, discountEnabled: c === true })
                  }
                />
                Apply discount
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Clarifications shown to the client."
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Exclusions</Label>
                <Textarea
                  rows={3}
                  value={form.exclusions}
                  onChange={(e) =>
                    setForm({ ...form, exclusions: e.target.value })
                  }
                  placeholder="Work explicitly not included."
                />
              </div>
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span>Subtotal cost</span>
                <span>{money(breakdown.subtotalCost)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Margin ({breakdown.marginPercent}%)</span>
                <span>{money(breakdown.marginAmount)}</span>
              </div>
              {breakdown.discountEnabled && breakdown.discountAmount > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Discount ({breakdown.discountPercent}%)</span>
                  <span>-{money(breakdown.discountAmount)}</span>
                </div>
              ) : null}
              {breakdown.salesTaxAmount > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Sales tax ({breakdown.salesTaxPercent}%)</span>
                  <span>{money(breakdown.salesTaxAmount)}</span>
                </div>
              ) : null}
              <Separator className="my-2" />
              <div className="flex justify-between text-base font-bold text-emerald-700">
                <span>Total</span>
                <span>{money(breakdown.totalPrice)}</span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || loading || !form}
          >
            {isEdit ? "Save changes" : "Create estimate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
