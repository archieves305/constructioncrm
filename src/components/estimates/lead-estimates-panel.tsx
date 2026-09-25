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
  ListChecks,
  ChevronDown,
  FileSignature,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toneClasses } from "@/lib/ui/tones";
import {
  ESTIMATE_STATUS_ACTIONS,
  ESTIMATE_STATUS_LABEL,
  ESTIMATE_STATUS_TONE,
  canGenerateContractFromEstimate,
  isEstimateStatus,
} from "@/lib/estimates/estimate-status";
import { useSetEstimateStatus } from "@/components/estimates/use-estimate-status";
import { GenerateContractDialog } from "@/components/estimates/generate-contract-dialog";
import { AddTaskDialog } from "@/components/tasks/add-task-dialog";
import { TaskCountBadge } from "@/components/tasks/task-count-badge";
import { useTasks } from "@/components/tasks/use-tasks";
import { isPast, isToday } from "date-fns";
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
  status: string;
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

/** Which estimate a contract is generated from — the two tables differ. */
export type ContractSource =
  | { kind: "GENERIC"; id: string; estimateNumber: string; total: number; status: string }
  | { kind: "ROOFING"; id: string; estimateNumber: string; total: number };

export function LeadEstimatesPanel({
  leadId,
  services = [],
  jobId,
  onGenerateContract,
}: {
  leadId: string;
  services?: LeadServiceLike[];
  /** Set when the panel is mounted on a job: enables the contract actions. */
  jobId?: string;
  onGenerateContract?: (source: ContractSource) => void;
}) {
  const queryClient = useQueryClient();
  const setStatus = useSetEstimateStatus(leadId);
  const [contractSource, setContractSource] = useState<ContractSource | null>(null);
  const contractsEnabled = Boolean(jobId);
  const generateContract = (source: ContractSource) => (onGenerateContract ? onGenerateContract(source) : setContractSource(source));
  const roofingRef = useRef<EstimatesPanelHandle>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [taskFor, setTaskFor] = useState<GenericEstimateRecord | null>(null);

  // One list query for the lead, grouped per estimate.
  const { data: leadTasks = [] } = useTasks({ leadId });
  const tasksByEstimate = (() => {
    const m = new Map<string, { open: number; overdue: number }>();
    for (const t of leadTasks) {
      if (!t.estimate) continue;
      const e = m.get(t.estimate.id) ?? { open: 0, overdue: 0 };
      e.open++;
      if (t.dueAt && isPast(new Date(t.dueAt)) && !isToday(new Date(t.dueAt))) e.overdue++;
      m.set(t.estimate.id, e);
    }
    return m;
  })();

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
          {jobId ? "Estimates for this job's customer." : "Estimates for this lead."}{" "}
          The template follows the lead&rsquo;s Services Needed. PDFs are
          saved to the Files tab tagged &ldquo;ESTIMATE&rdquo;.
          {contractsEnabled && " Mark an estimate accepted to generate the contract from it."}
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
      <EstimatesPanel
        ref={roofingRef}
        leadId={leadId}
        hideNewButton
        onGenerateContract={contractsEnabled ? (est) => generateContract({ kind: "ROOFING", id: est.id, estimateNumber: est.estimateNumber, total: est.totalPrice }) : undefined}
      />

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
                        {isEstimateStatus(est.status) && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses(ESTIMATE_STATUS_TONE[est.status]).pill}`}
                          >
                            {ESTIMATE_STATUS_LABEL[est.status]}
                          </span>
                        )}
                        {(() => {
                          const c = tasksByEstimate.get(est.id);
                          return c ? <TaskCountBadge open={c.open} overdue={c.overdue} compact /> : null;
                        })()}
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
                    <Button size="sm" variant="ghost" onClick={() => setTaskFor(est)}>
                      <ListChecks className="mr-1 h-3.5 w-3.5" />
                      Add task
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button size="sm" variant="ghost" disabled={setStatus.isPending} />}
                      >
                        Status
                        <ChevronDown className="ml-1 h-3.5 w-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {ESTIMATE_STATUS_ACTIONS.map((a) => (
                          <DropdownMenuItem
                            key={a.to}
                            disabled={est.status === a.to}
                            onClick={() => setStatus.mutate({ estimateId: est.id, status: a.to })}
                          >
                            {a.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {contractsEnabled && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canGenerateContractFromEstimate(est.status)}
                        title={
                          canGenerateContractFromEstimate(est.status)
                            ? "Generate a customer contract from this estimate"
                            : "Mark the estimate accepted first"
                        }
                        onClick={() =>
                          generateContract({
                            kind: "GENERIC",
                            id: est.id,
                            estimateNumber: est.estimateNumber,
                            total: Number(est.totalPrice),
                            status: est.status,
                          })
                        }
                      >
                        <FileSignature className="mr-1 h-3.5 w-3.5" />
                        Generate contract
                      </Button>
                    )}
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

      <AddTaskDialog
        open={Boolean(taskFor)}
        onOpenChange={(o) => !o && setTaskFor(null)}
        context={
          taskFor
            ? {
                estimateId: taskFor.id,
                leadId,
                label: `${taskFor.estimateNumber} · ${taskFor.name}`,
                href: `/leads/${leadId}`,
              }
            : undefined
        }
        defaults={taskFor ? { title: `Follow up on estimate ${taskFor.estimateNumber}` } : undefined}
        invalidateKeys={[["lead", leadId]]}
      />

      <GenericEstimateDialog
        leadId={leadId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
      />

      {jobId && (
        <GenerateContractDialog jobId={jobId} leadId={leadId} source={contractSource} onOpenChange={(o) => !o && setContractSource(null)} />
      )}
    </div>
  );
}
