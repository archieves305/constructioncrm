"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
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
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Plus,
  Trash2,
  Pencil,
  Download,
  Building2,
  X,
} from "lucide-react";
import {
  calculateEstimate,
  MATERIAL_LABELS,
  type EstimateInput,
  type RoofMaterialKey,
} from "@/lib/estimates/calc";

type EstimateRecord = {
  id: string;
  estimateNumber: string;
  roofTypesJson: Array<{
    material: RoofMaterialKey;
    squares: number;
    laborRatePerSquare: number;
  }>;
  materialCost: string;
  materialSelection: string | null;
  existingRoofType: string | null;
  proposedRoofTypeOverride: string | null;
  underlaymentType: string | null;
  permitIncluded: boolean;
  projectDurationText: string | null;
  plywoodSheetsIncluded: number | null;
  additionalPlywoodPrice: string | null;
  workmanshipWarrantyYears: number | null;
  manufacturerWarranty: string | null;
  isEstimateOnly: boolean;
  permitFee: string;
  dumpsterFee: string;
  tearOffFee: string;
  deckingFee: string;
  underlaymentFee: string;
  flashingVentFee: string;
  skylightChimneyFee: string;
  guttersFee: string;
  miscLabel: string | null;
  miscFee: string;
  marginPercent: string;
  discountEnabled: boolean;
  discountPercent: string;
  salesTaxPercent: string;
  validityDays: number;
  specialTerms: string | null;
  subtotalCost: string;
  totalPrice: string;
  createdAt: string;
  createdBy: { firstName: string; lastName: string };
};

type RoofTypeFormRow = {
  material: RoofMaterialKey;
  squares: string;
  laborRatePerSquare: string;
};

type FormState = {
  roofTypes: RoofTypeFormRow[];
  materialCost: string;
  materialSelection: string;
  existingRoofType: string;
  proposedRoofTypeOverride: string;
  underlaymentType: string;
  permitIncluded: boolean;
  projectDurationText: string;
  plywoodSheetsIncluded: string;
  additionalPlywoodPrice: string;
  workmanshipWarrantyYears: string;
  manufacturerWarranty: string;
  isEstimateOnly: boolean;
  permitFee: string;
  dumpsterFee: string;
  tearOffFee: string;
  deckingFee: string;
  underlaymentFee: string;
  flashingVentFee: string;
  skylightChimneyFee: string;
  guttersFee: string;
  miscLabel: string;
  miscFee: string;
  marginPercent: string;
  discountEnabled: boolean;
  discountPercent: string;
  salesTaxPercent: string;
  validityDays: string;
  specialTerms: string;
};

const MATERIALS: RoofMaterialKey[] = ["SHINGLE", "TILE", "METAL", "FLAT"];

function emptyForm(defaults?: BrandDefaults | null): FormState {
  return {
    roofTypes: [{ material: "SHINGLE", squares: "", laborRatePerSquare: "" }],
    materialCost: "",
    materialSelection: "",
    existingRoofType: "",
    proposedRoofTypeOverride: "",
    underlaymentType: defaults?.defaultUnderlaymentType ?? "",
    permitIncluded: true,
    projectDurationText: "",
    plywoodSheetsIncluded:
      defaults?.defaultPlywoodSheetsIncluded != null
        ? String(defaults.defaultPlywoodSheetsIncluded)
        : "",
    additionalPlywoodPrice:
      defaults?.defaultAdditionalPlywoodPrice != null
        ? String(defaults.defaultAdditionalPlywoodPrice)
        : "",
    workmanshipWarrantyYears:
      defaults?.defaultWorkmanshipWarrantyYears != null
        ? String(defaults.defaultWorkmanshipWarrantyYears)
        : "",
    manufacturerWarranty: defaults?.defaultManufacturerWarranty ?? "",
    isEstimateOnly: false,
    permitFee: "",
    dumpsterFee: "",
    tearOffFee: "",
    deckingFee: "",
    underlaymentFee: "",
    flashingVentFee: "",
    skylightChimneyFee: "",
    guttersFee: "",
    miscLabel: "",
    miscFee: "",
    marginPercent: "20",
    discountEnabled: false,
    discountPercent: "0",
    salesTaxPercent: "0",
    validityDays:
      defaults?.defaultExpirationDays != null
        ? String(defaults.defaultExpirationDays)
        : "30",
    specialTerms: "",
  };
}

type BrandDefaults = {
  defaultExpirationDays: number;
  defaultUnderlaymentType: string | null;
  defaultPlywoodSheetsIncluded: number;
  defaultAdditionalPlywoodPrice: number;
  defaultWorkmanshipWarrantyYears: number;
  defaultManufacturerWarranty: string | null;
};

function recordToForm(r: EstimateRecord): FormState {
  return {
    roofTypes: r.roofTypesJson.map((rt) => ({
      material: rt.material,
      squares: String(rt.squares),
      laborRatePerSquare: String(rt.laborRatePerSquare),
    })),
    materialCost: String(Number(r.materialCost)),
    materialSelection: r.materialSelection ?? "",
    existingRoofType: r.existingRoofType ?? "",
    proposedRoofTypeOverride: r.proposedRoofTypeOverride ?? "",
    underlaymentType: r.underlaymentType ?? "",
    permitIncluded: r.permitIncluded,
    projectDurationText: r.projectDurationText ?? "",
    plywoodSheetsIncluded:
      r.plywoodSheetsIncluded != null ? String(r.plywoodSheetsIncluded) : "",
    additionalPlywoodPrice:
      r.additionalPlywoodPrice != null
        ? String(Number(r.additionalPlywoodPrice))
        : "",
    workmanshipWarrantyYears:
      r.workmanshipWarrantyYears != null
        ? String(r.workmanshipWarrantyYears)
        : "",
    manufacturerWarranty: r.manufacturerWarranty ?? "",
    isEstimateOnly: r.isEstimateOnly,
    permitFee: String(Number(r.permitFee)),
    dumpsterFee: String(Number(r.dumpsterFee)),
    tearOffFee: String(Number(r.tearOffFee)),
    deckingFee: String(Number(r.deckingFee)),
    underlaymentFee: String(Number(r.underlaymentFee)),
    flashingVentFee: String(Number(r.flashingVentFee)),
    skylightChimneyFee: String(Number(r.skylightChimneyFee)),
    guttersFee: String(Number(r.guttersFee)),
    miscLabel: r.miscLabel ?? "",
    miscFee: String(Number(r.miscFee)),
    marginPercent: String(Number(r.marginPercent)),
    discountEnabled: r.discountEnabled,
    discountPercent: String(Number(r.discountPercent)),
    salesTaxPercent: String(Number(r.salesTaxPercent)),
    validityDays: String(r.validityDays),
    specialTerms: r.specialTerms ?? "",
  };
}

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

function formToInput(form: FormState): EstimateInput {
  return {
    roofTypes: form.roofTypes
      .filter((r) => r.squares !== "" && r.laborRatePerSquare !== "")
      .map((r) => ({
        material: r.material,
        squares: num(r.squares),
        laborRatePerSquare: num(r.laborRatePerSquare),
      })),
    materialCost: num(form.materialCost),
    materialSelection: form.materialSelection.trim() || null,
    permitFee: num(form.permitFee),
    dumpsterFee: num(form.dumpsterFee),
    tearOffFee: num(form.tearOffFee),
    deckingFee: num(form.deckingFee),
    underlaymentFee: num(form.underlaymentFee),
    flashingVentFee: num(form.flashingVentFee),
    skylightChimneyFee: num(form.skylightChimneyFee),
    guttersFee: num(form.guttersFee),
    miscLabel: form.miscLabel.trim() || null,
    miscFee: num(form.miscFee),
    marginPercent: num(form.marginPercent),
    discountEnabled: form.discountEnabled,
    discountPercent: num(form.discountPercent),
    salesTaxPercent: num(form.salesTaxPercent),
  };
}

function formToApiPayload(form: FormState) {
  return {
    ...formToInput(form),
    existingRoofType: form.existingRoofType.trim() || null,
    proposedRoofTypeOverride: form.proposedRoofTypeOverride.trim() || null,
    underlaymentType: form.underlaymentType.trim() || null,
    permitIncluded: form.permitIncluded,
    projectDurationText: form.projectDurationText.trim() || null,
    plywoodSheetsIncluded:
      form.plywoodSheetsIncluded === "" ? null : num(form.plywoodSheetsIncluded),
    additionalPlywoodPrice:
      form.additionalPlywoodPrice === ""
        ? null
        : num(form.additionalPlywoodPrice),
    workmanshipWarrantyYears:
      form.workmanshipWarrantyYears === ""
        ? null
        : num(form.workmanshipWarrantyYears),
    manufacturerWarranty: form.manufacturerWarranty.trim() || null,
    isEstimateOnly: form.isEstimateOnly,
    validityDays: num(form.validityDays),
    specialTerms: form.specialTerms.trim() || null,
  };
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function EstimatesPanel({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const { data: estimates = [], isLoading } = useQuery<EstimateRecord[]>({
    queryKey: ["lead-estimates", leadId],
    queryFn: () =>
      fetch(`/api/leads/${leadId}/estimates`).then((r) => r.json()),
  });

  const { data: brandDefaults } = useQuery<{
    defaultExpirationDays: number;
    defaultUnderlaymentType: string | null;
    defaultPlywoodSheetsIncluded: number;
    defaultAdditionalPlywoodPrice: string;
    defaultWorkmanshipWarrantyYears: number;
    defaultManufacturerWarranty: string | null;
  }>({
    queryKey: ["roofing-brand"],
    queryFn: () =>
      fetch("/api/admin/roofing-brand").then((r) => r.json()),
  });

  const breakdown = useMemo(
    () => calculateEstimate(formToInput(form)),
    [form],
  );

  function openCreate() {
    setEditingId(null);
    setForm(
      emptyForm(
        brandDefaults
          ? {
              defaultExpirationDays: brandDefaults.defaultExpirationDays,
              defaultUnderlaymentType: brandDefaults.defaultUnderlaymentType,
              defaultPlywoodSheetsIncluded:
                brandDefaults.defaultPlywoodSheetsIncluded,
              defaultAdditionalPlywoodPrice: Number(
                brandDefaults.defaultAdditionalPlywoodPrice,
              ),
              defaultWorkmanshipWarrantyYears:
                brandDefaults.defaultWorkmanshipWarrantyYears,
              defaultManufacturerWarranty:
                brandDefaults.defaultManufacturerWarranty,
            }
          : null,
      ),
    );
    setDialogOpen(true);
  }

  function openEdit(r: EstimateRecord) {
    setEditingId(r.id);
    setForm(recordToForm(r));
    setDialogOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const url = editingId
        ? `/api/leads/${leadId}/estimates/${editingId}`
        : `/api/leads/${leadId}/estimates`;
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToApiPayload(form)),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(editingId ? "Estimate updated" : "Estimate created");
      queryClient.invalidateQueries({ queryKey: ["lead-estimates", leadId] });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/leads/${leadId}/estimates/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Estimate deleted");
      queryClient.invalidateQueries({ queryKey: ["lead-estimates", leadId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generatePdf = useMutation({
    mutationFn: async ({
      id,
      kind,
    }: {
      id: string;
      kind: "client" | "internal";
    }) => {
      const res = await fetch(
        `/api/leads/${leadId}/estimates/${id}/pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "PDF generation failed");
      }
      return res.json() as Promise<{
        file: { id: string; fileName: string };
        kind: "client" | "internal";
      }>;
    },
    onSuccess: (data) => {
      toast.success(
        `${data.kind === "client" ? "Client" : "Internal"} PDF saved to Files`,
      );
      queryClient.invalidateQueries({ queryKey: ["lead-files", leadId] });
      // Open the freshly-saved PDF in a new tab
      window.open(`/api/files/${data.file.id}`, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Roofing estimates for this lead. Generated PDFs are saved to the
          Files tab tagged as &ldquo;ESTIMATE&rdquo; and labeled Client or
          Internal.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          New estimate
        </Button>
      </div>

      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">Loading…</p>
      ) : estimates.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No estimates yet. Click &ldquo;New estimate&rdquo; to create one.
        </p>
      ) : (
        <div className="space-y-3">
          {estimates.map((est) => (
            <Card key={est.id}>
              <CardContent className="py-3 px-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{est.estimateNumber}</span>
                      <Badge variant="outline" className="text-xs">
                        {est.roofTypesJson
                          .map((rt) => MATERIAL_LABELS[rt.material])
                          .join(" + ")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {format(new Date(est.createdAt), "MMM d, yyyy h:mm a")} ·{" "}
                      {est.createdBy.firstName} {est.createdBy.lastName} ·{" "}
                      {est.roofTypesJson.reduce(
                        (s, rt) => s + Number(rt.squares),
                        0,
                      )}{" "}
                      sq · cost {money(Number(est.subtotalCost))}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-emerald-700">
                      {money(Number(est.totalPrice))}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() =>
                      generatePdf.mutate({ id: est.id, kind: "client" })
                    }
                    disabled={generatePdf.isPending}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    Client PDF
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      generatePdf.mutate({ id: est.id, kind: "internal" })
                    }
                    disabled={generatePdf.isPending}
                  >
                    <Building2 className="mr-1 h-3.5 w-3.5" />
                    Internal PDF
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(est)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (
                        confirm(
                          `Delete estimate ${est.estimateNumber}? Generated PDFs will remain in Files.`,
                        )
                      ) {
                        remove.mutate(est.id);
                      }
                    }}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-full max-w-3xl sm:max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit roofing estimate" : "New roofing estimate"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <RoofTypesEditor
              rows={form.roofTypes}
              onChange={(rows) =>
                setForm((f) => ({ ...f, roofTypes: rows }))
              }
            />

            <div>
              <h3 className="mb-2 text-sm font-semibold">Materials</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MoneyField
                  label="Hard material cost"
                  value={form.materialCost}
                  onChange={(v) => setForm((f) => ({ ...f, materialCost: v }))}
                />
                <div className="space-y-1">
                  <Label className="text-xs">
                    Material selection (brand / model)
                  </Label>
                  <Input
                    placeholder="e.g., GAF Timberline HDZ — Charcoal"
                    value={form.materialSelection}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        materialSelection: e.target.value,
                      }))
                    }
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Appears on the client proposal under &ldquo;Roofing
                    material selected&rdquo;.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">
                Customer proposal details
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                These appear on the client-facing PDF. Defaults come from{" "}
                <span className="italic">Admin → Settings → Roofing Proposal</span>{" "}
                and can be overridden per estimate.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Existing roof type</Label>
                  <Input
                    placeholder="e.g., 25-year asphalt shingle, ~18 yrs old"
                    value={form.existingRoofType}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        existingRoofType: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Proposed roof type (override)
                  </Label>
                  <Input
                    placeholder="Defaults to roof types above if blank"
                    value={form.proposedRoofTypeOverride}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        proposedRoofTypeOverride: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Underlayment system</Label>
                  <Textarea
                    rows={2}
                    value={form.underlaymentType}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        underlaymentType: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Estimated project duration</Label>
                  <Input
                    placeholder="e.g., 3–5 working days"
                    value={form.projectDurationText}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        projectDurationText: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-end">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="permit-included"
                      checked={form.permitIncluded}
                      onCheckedChange={(v: boolean) =>
                        setForm((f) => ({ ...f, permitIncluded: !!v }))
                      }
                    />
                    <Label
                      htmlFor="permit-included"
                      className="cursor-pointer text-sm"
                    >
                      Permit coordination included
                    </Label>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Plywood sheets included (allowance)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.plywoodSheetsIncluded}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        plywoodSheetsIncluded: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Additional plywood ($ per sheet)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={form.additionalPlywoodPrice}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        additionalPlywoodPrice: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Workmanship warranty (years)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.workmanshipWarrantyYears}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        workmanshipWarrantyYears: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Manufacturer warranty</Label>
                  <Textarea
                    rows={2}
                    value={form.manufacturerWarranty}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        manufacturerWarranty: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Checkbox
                    id="estimate-only"
                    checked={form.isEstimateOnly}
                    onCheckedChange={(v: boolean) =>
                      setForm((f) => ({ ...f, isEstimateOnly: !!v }))
                    }
                  />
                  <Label
                    htmlFor="estimate-only"
                    className="cursor-pointer text-sm"
                  >
                    Mark as &ldquo;Estimate Only&rdquo; (non-binding) &mdash;
                    omits acceptance/signature blocks
                  </Label>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Required fees</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MoneyField
                  label="Permit fee"
                  value={form.permitFee}
                  onChange={(v) => setForm((f) => ({ ...f, permitFee: v }))}
                />
                <MoneyField
                  label="Dumpster fee"
                  value={form.dumpsterFee}
                  onChange={(v) => setForm((f) => ({ ...f, dumpsterFee: v }))}
                />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Optional line items</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Leave blank if not applicable. These are common roofing add-ons
                worth pricing in.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MoneyField
                  label="Tear-off / disposal"
                  value={form.tearOffFee}
                  onChange={(v) => setForm((f) => ({ ...f, tearOffFee: v }))}
                />
                <MoneyField
                  label="Decking / plywood replacement"
                  value={form.deckingFee}
                  onChange={(v) => setForm((f) => ({ ...f, deckingFee: v }))}
                />
                <MoneyField
                  label="Underlayment / ice & water shield upgrade"
                  value={form.underlaymentFee}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, underlaymentFee: v }))
                  }
                />
                <MoneyField
                  label="Flashing / drip edge / vents"
                  value={form.flashingVentFee}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, flashingVentFee: v }))
                  }
                />
                <MoneyField
                  label="Skylight / chimney work"
                  value={form.skylightChimneyFee}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, skylightChimneyFee: v }))
                  }
                />
                <MoneyField
                  label="Gutters / downspouts"
                  value={form.guttersFee}
                  onChange={(v) => setForm((f) => ({ ...f, guttersFee: v }))}
                />
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Misc line item</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Label (e.g., Satellite dish reinstall)"
                      value={form.miscLabel}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, miscLabel: e.target.value }))
                      }
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      className="w-32"
                      value={form.miscFee}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, miscFee: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Pricing</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <PercentField
                  label="Margin %"
                  hint="True margin: price = cost ÷ (1 − margin%)"
                  value={form.marginPercent}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, marginPercent: v }))
                  }
                />
                <PercentField
                  label="Sales tax %"
                  hint="Applied to subtotal after discount"
                  value={form.salesTaxPercent}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, salesTaxPercent: v }))
                  }
                />
                <div className="space-y-1">
                  <Label className="text-xs">Validity (days)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="365"
                    value={form.validityDays}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, validityDays: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 rounded border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="discount-toggle"
                    checked={form.discountEnabled}
                    onCheckedChange={(v: boolean) =>
                      setForm((f) => ({ ...f, discountEnabled: !!v }))
                    }
                  />
                  <Label
                    htmlFor="discount-toggle"
                    className="cursor-pointer text-sm font-medium"
                  >
                    Apply discount
                  </Label>
                </div>
                {form.discountEnabled && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      className="w-24"
                      value={form.discountPercent}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          discountPercent: e.target.value,
                        }))
                      }
                    />
                    <span className="text-sm">% off price after margin</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label className="text-xs">
                Special terms for this client (appears on both PDFs)
              </Label>
              <Textarea
                rows={3}
                value={form.specialTerms}
                onChange={(e) =>
                  setForm((f) => ({ ...f, specialTerms: e.target.value }))
                }
                placeholder="e.g., Color upgrade to GAF Timberline HDZ Charcoal at no extra charge."
              />
            </div>

            <Separator />

            <BreakdownSummary breakdown={breakdown} />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending ||
                breakdown.roofTypes.length === 0 ||
                breakdown.totalSquares <= 0
              }
            >
              {editingId ? "Save changes" : "Create estimate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoofTypesEditor({
  rows,
  onChange,
}: {
  rows: RoofTypeFormRow[];
  onChange: (rows: RoofTypeFormRow[]) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Roof types</h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange([
              ...rows,
              { material: "SHINGLE", squares: "", laborRatePerSquare: "" },
            ])
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add roof type
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Add one row per material on the roof. Labor cost = squares ×
        $/square (all-in for materials + labor for that section).
      </p>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-1 items-end gap-2 rounded border p-2 sm:grid-cols-[1fr_120px_140px_auto]"
          >
            <div className="space-y-1">
              <Label className="text-xs">Material</Label>
              <Select
                value={row.material}
                onValueChange={(v: string | null) => {
                  if (!v) return;
                  const next = [...rows];
                  next[i] = { ...next[i], material: v as RoofMaterialKey };
                  onChange(next);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIALS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {MATERIAL_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Squares</Label>
              <Input
                type="number"
                min="0"
                step="0.1"
                placeholder="0"
                value={row.squares}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...next[i], squares: e.target.value };
                  onChange(next);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">$ / square</Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="0.00"
                value={row.laborRatePerSquare}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = {
                    ...next[i],
                    laborRatePerSquare: e.target.value,
                  };
                  onChange(next);
                }}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={rows.length === 1}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              title="Remove row"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min="0"
        step="0.01"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function PercentField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min="0"
        step="0.1"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function BreakdownSummary({
  breakdown,
}: {
  breakdown: ReturnType<typeof calculateEstimate>;
}) {
  return (
    <div className="rounded border bg-slate-50 p-3 text-sm">
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
        Live breakdown
      </h3>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <Row label="Labor total" value={money(breakdown.laborTotal)} />
        <Row label="Material cost" value={money(breakdown.materialCost)} />
        <Row
          label="Other fees total"
          value={money(breakdown.otherFeesTotal)}
        />
        <Row
          label="Subtotal cost"
          value={money(breakdown.subtotalCost)}
          bold
        />
        <Row
          label={`Margin (${breakdown.marginPercent}%)`}
          value={money(breakdown.marginAmount)}
        />
        <Row
          label="Price with margin"
          value={money(breakdown.priceWithMargin)}
          bold
        />
        {breakdown.discountEnabled && breakdown.discountAmount > 0 && (
          <>
            <Row
              label={`Discount (${breakdown.discountPercent}%)`}
              value={`-${money(breakdown.discountAmount)}`}
            />
            <Row
              label="Price after discount"
              value={money(breakdown.priceAfterDiscount)}
              bold
            />
          </>
        )}
        {breakdown.salesTaxAmount > 0 && (
          <Row
            label={`Sales tax (${breakdown.salesTaxPercent}%)`}
            value={money(breakdown.salesTaxAmount)}
          />
        )}
      </div>
      <div className="mt-3 flex items-center justify-between border-t pt-2">
        <span className="font-semibold">Total client price</span>
        <span className="text-xl font-bold text-emerald-700">
          {money(breakdown.totalPrice)}
        </span>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        bold ? "font-semibold" : ""
      }`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
