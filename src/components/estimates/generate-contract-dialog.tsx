"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Callout } from "@/components/shared/callout";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { FileSignature } from "lucide-react";
import { useCreateContract, useJobContracts, usePublishedContractTemplates } from "@/components/customer-contracts/use-customer-contracts";
import type { ContractSource } from "@/components/estimates/lead-estimates-panel";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type OptionalLine = { id: string; description: string; quantity: string; unitPrice: string; section: string };

export function GenerateContractDialog({
  jobId,
  leadId,
  source,
  onOpenChange,
}: {
  jobId: string;
  leadId: string;
  source: ContractSource | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const create = useCreateContract(jobId);
  const { data: templates = [], isLoading: loadingTemplates } = usePublishedContractTemplates(Boolean(source));
  const { data: contracts = [] } = useJobContracts(jobId, { enabled: Boolean(source) });
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  if (source && sourceKey !== source.id) {
    setSourceKey(source.id);
    setSelected(new Set());
    setTemplateKey(null);
  }

  // Optional lines on a template estimate: the customer's choices become part of the contract.
  const { data: estimate } = useQuery<{ sections: { title: string; items: { id: string; description: string; quantity: string; unitPrice: string; isOptional: boolean }[] }[] }>({
    queryKey: ["lead-template-estimate", leadId, source?.id],
    queryFn: () => fetchJson(`/api/leads/${leadId}/template-estimates/${source?.id}`),
    enabled: Boolean(source && source.kind === "GENERIC"),
    retry: retryServerErrors,
  });
  const optionalLines: OptionalLine[] =
    estimate?.sections.flatMap((s) => s.items.filter((i) => i.isOptional).map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, section: s.title }))) ?? [];

  const defaultTemplate = templates.find((t) => t.isDefault) ?? templates[0];
  const chosenKey = templateKey ?? defaultTemplate?.key ?? null;
  const open = contracts.find((c) => c.status === "SENT" || c.status === "SIGNED");

  function submit() {
    if (!source) return;
    create.mutate(
      {
        estimateId: source.kind === "GENERIC" ? source.id : undefined,
        roofEstimateId: source.kind === "ROOFING" ? source.id : undefined,
        includeOptionalItemIds: [...selected],
        templateKey: chosenKey,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          const next = new URLSearchParams(searchParams.toString());
          next.set("tab", "money");
          next.set("sub", "contract");
          router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        },
      },
    );
  }

  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate contract from {source?.estimateNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            A draft agreement is built from this estimate&rsquo;s current line items{source?.kind === "ROOFING" ? " and proposal details" : ""}, priced at {source ? money(source.total) : ""}
            {selected.size > 0 ? " plus the selected options" : ""}. You can preview it before sending.
          </p>

          {open && (
            <Callout tone="warning" title={`${open.contractNumber} is already ${open.status === "SIGNED" ? "signed" : "out for signature"}`}>
              You can still create a draft, but it cannot be sent until that one is voided.
            </Callout>
          )}

          <div>
            <Label className="text-xs">Agreement template</Label>
            {loadingTemplates ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : templates.length === 0 ? (
              <Callout tone="danger">No published contract template. An admin needs to publish one under Admin → Contract Templates.</Callout>
            ) : (
              <Select value={chosenKey ?? undefined} onValueChange={(v: string | null) => v && setTemplateKey(v)}>
                <SelectTrigger>
                  <SelectValue>{(v: string) => templates.find((t) => t.key === v)?.name ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name} · v{t.published?.version}
                      {t.isDefault ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {optionalLines.length > 0 && (
            <div>
              <Label className="text-xs">Optional items the customer accepted</Label>
              <div className="mt-1 space-y-1.5 rounded-md border p-2">
                {optionalLines.map((l) => (
                  <label key={l.id} className="flex cursor-pointer items-start gap-2 text-sm">
                    <Checkbox
                      checked={selected.has(l.id)}
                      onCheckedChange={(v) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(l.id);
                          else next.delete(l.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      {l.description}
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {l.section} · {Number(l.quantity)} × {money(Number(l.unitPrice))}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Unchecked options are left out of the contract entirely.</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="brand" disabled={!source || !chosenKey || create.isPending} onClick={submit}>
              <FileSignature className="mr-1 h-4 w-4" /> Create draft contract
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
