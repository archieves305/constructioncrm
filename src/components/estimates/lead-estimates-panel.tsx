"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  FileText,
  Plus,
  Trash2,
  Pencil,
  Download,
  Building2,
} from "lucide-react";
import {
  EstimatesPanel,
  type EstimatesPanelHandle,
} from "@/components/estimates/estimates-panel";
import {
  GenericEstimateDialog,
  type DialogMode,
} from "@/components/estimates/generic-estimate-dialog";
import { CATEGORY_LABELS } from "@/lib/estimates/generic-calc";
import {
  decideEstimateRoute,
  ALL_CATEGORIES,
  type LeadServiceLike,
} from "@/lib/estimates/template-routing";
import type { EstimateTemplateCategory } from "@/generated/prisma/enums";

type GenericEstimateRecord = {
  id: string;
  estimateNumber: string;
  name: string;
  templateCategory: string;
  subtotalCost: string;
  totalPrice: string;
  createdAt: string;
  createdBy: { firstName: string; lastName: string };
};

const money = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function LeadEstimatesPanel({
  leadId,
  services = [],
}: {
  leadId: string;
  services?: LeadServiceLike[];
}) {
  const queryClient = useQueryClient();
  const roofingRef = useRef<EstimatesPanelHandle>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);

  const { data: estimates = [], isLoading } = useQuery<GenericEstimateRecord[]>({
    queryKey: ["lead-template-estimates", leadId],
    queryFn: () =>
      fetch(`/api/leads/${leadId}/template-estimates`).then((r) => r.json()),
  });

  const decision = decideEstimateRoute(services);

  function startCategory(category: EstimateTemplateCategory) {
    if (category === "ROOFING") {
      roofingRef.current?.openCreate();
      return;
    }
    setDialogMode({ kind: "create", category });
    setDialogOpen(true);
  }

  function editGeneric(id: string) {
    setDialogMode({ kind: "edit", estimateId: id });
    setDialogOpen(true);
  }

  const generatePdf = useMutation({
    mutationFn: async ({
      id,
      kind,
    }: {
      id: string;
      kind: "client" | "internal";
    }) => {
      const res = await fetch(
        `/api/leads/${leadId}/template-estimates/${id}/pdf`,
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
        file: { id: string };
        kind: "client" | "internal";
      }>;
    },
    onSuccess: (data) => {
      toast.success(
        `${data.kind === "client" ? "Client" : "Internal"} PDF saved to Files`,
      );
      queryClient.invalidateQueries({ queryKey: ["lead-files", leadId] });
      window.open(`/api/files/${data.file.id}`, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/leads/${leadId}/template-estimates/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Estimate deleted");
      queryClient.invalidateQueries({
        queryKey: ["lead-template-estimates", leadId],
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pickerCategories =
    decision.kind === "picker" ? decision.categories : ALL_CATEGORIES;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Estimates for this lead. The template follows the lead&rsquo;s
          Services Needed. PDFs are saved to the Files tab tagged
          &ldquo;ESTIMATE&rdquo;.
        </p>

        {decision.kind === "roofing" ? (
          <Button size="sm" onClick={() => startCategory("ROOFING")}>
            <Plus className="mr-1 h-4 w-4" />
            New roofing estimate
          </Button>
        ) : decision.kind === "generic" ? (
          <Button size="sm" onClick={() => startCategory(decision.category)}>
            <Plus className="mr-1 h-4 w-4" />
            New {CATEGORY_LABELS[decision.category]} estimate
          </Button>
        ) : (
          <Popover>
            <PopoverTrigger
              render={
                <Button size="sm">
                  <Plus className="mr-1 h-4 w-4" />
                  New estimate
                </Button>
              }
            />
            <PopoverContent align="end" className="w-56 p-1">
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Choose a template
              </p>
              {pickerCategories.map((cat) => (
                <button
                  key={cat}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => startCategory(cat)}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Roofing estimates — rendered by the existing specialized panel. */}
      <EstimatesPanel ref={roofingRef} leadId={leadId} hideNewButton />

      {/* Generic template estimates (Drywall / Interior Reno / Windows & Doors). */}
      {estimates.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            {estimates.map((est) => (
              <Card key={est.id}>
                <CardContent className="py-3 px-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">
                          {est.estimateNumber}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {CATEGORY_LABELS[est.templateCategory] ??
                            est.templateCategory}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {est.name} ·{" "}
                        {format(new Date(est.createdAt), "MMM d, yyyy h:mm a")} ·{" "}
                        {est.createdBy.firstName} {est.createdBy.lastName} · cost{" "}
                        {money(Number(est.subtotalCost))}
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
                      onClick={() => editGeneric(est.id)}
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
        </>
      )}

      {!isLoading && estimates.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          No template estimates yet.
        </p>
      )}

      <GenericEstimateDialog
        leadId={leadId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
      />
    </div>
  );
}
