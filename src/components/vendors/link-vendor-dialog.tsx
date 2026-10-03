"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import { KIND_LABEL, useVendorOptions, type VendorLink } from "./use-vendors";

/** Connect a payee spelling, a crew or a typed contractor name to a vendor that already exists. */
export function LinkVendorDialog({
  link,
  title,
  description,
  onClose,
}: {
  link: VendorLink | null;
  title: string;
  description: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(link)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {link && <LinkForm link={link} title={title} description={description} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function LinkForm({ link, title, description, onClose }: { link: VendorLink; title: string; description: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: vendors = [], isLoading } = useVendorOptions();
  const [vendorId, setVendorId] = useState("");

  const save = useMutation({
    mutationFn: () =>
      fetchJson<{ expensesLinked: number; contractsLinked: number; crewLinked: boolean }>(`/api/vendors/${vendorId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(link),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      const name = vendors.find((v) => v.id === vendorId)?.name ?? "the vendor";
      const what = r.crewLinked
        ? "Crew linked"
        : r.contractsLinked
          ? `${r.contractsLinked} labor contract${r.contractsLinked === 1 ? "" : "s"} linked`
          : `${r.expensesLinked} expense${r.expensesLinked === 1 ? "" : "s"} linked`;
      toast.success(`${what} to ${name}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label>Vendor</Label>
        <Select value={vendorId} onValueChange={(v: string | null) => setVendorId(v ?? "")}>
          <SelectTrigger className="w-full" aria-label="Vendor">
            <SelectValue placeholder={isLoading ? "Loading…" : vendors.length ? "Choose a vendor" : "No vendors yet"}>
              {(v: string) => vendors.find((o) => o.id === v)?.name ?? (isLoading ? "Loading…" : vendors.length ? "Choose a vendor" : "No vendors yet")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {vendors.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name} <span className="text-xs text-muted-foreground">· {KIND_LABEL[v.kind]}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!vendorId || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Linking…" : "Link"}</Button>
      </DialogFooter>
    </div>
  );
}
