"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";
import { formatFileSize, uploadProblem } from "@/lib/files/limits";
import { DOC_TYPE_LABEL, type VendorDocType } from "@/lib/vendors/compliance";
import type { VendorDocument } from "./use-vendors";

const TYPES = Object.keys(DOC_TYPE_LABEL) as VendorDocType[];
/** A W-9 does not run out; everything else may. */
const DATED = (t: VendorDocType) => t !== "W9";
const INSURED = (t: VendorDocType) => t === "GL_INSURANCE" || t === "WORKERS_COMP";

const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/**
 * Add a compliance document, or correct the dates on one. Adding a newer
 * document of the same kind replaces the old one as the document in force;
 * the old one stays in the history.
 */
export function DocumentDialog({
  vendorId,
  open,
  onOpenChange,
  initialType,
  editing,
}: {
  vendorId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: VendorDocType;
  editing?: VendorDocument | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <DocumentForm vendorId={vendorId} initialType={initialType} editing={editing ?? null} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function DocumentForm({ vendorId, initialType, editing, onClose }: { vendorId: string; initialType?: VendorDocType; editing: VendorDocument | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<VendorDocType>(editing?.type ?? initialType ?? "GL_INSURANCE");
  const [carrier, setCarrier] = useState(editing?.carrier ?? "");
  const [policyNumber, setPolicyNumber] = useState(editing?.policyNumber ?? "");
  const [effectiveDate, setEffectiveDate] = useState(dayOf(editing?.effectiveDate ?? null));
  const [expiresAt, setExpiresAt] = useState(dayOf(editing?.expiresAt ?? null));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const fields = { type, carrier, policyNumber, effectiveDate: DATED(type) ? effectiveDate : "", expiresAt: DATED(type) ? expiresAt : "", notes };
      if (editing) {
        return fetchJson(`/api/vendors/${vendorId}/documents/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      }
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      if (file) form.set("file", file);
      return fetchJson(`/api/vendors/${vendorId}/documents`, { method: "POST", body: form });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      qc.invalidateQueries({ queryKey: ["labor-contracts"] });
      toast.success(editing ? "Document updated" : `${DOC_TYPE_LABEL[type]} added`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (DATED(type) && effectiveDate && expiresAt && expiresAt < effectiveDate) return toast.error("The expiry date is before the effective date");
        save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? "Edit document" : "Add document"}</DialogTitle>
        <DialogDescription>
          {editing ? "Correct the details recorded for this document." : "The newest document of a kind is the one in force; earlier ones stay in the history."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label>Kind</Label>
        <Select value={type} onValueChange={(v: string | null) => v && setType(v as VendorDocType)}>
          <SelectTrigger className="w-full" aria-label="Document kind">
            <SelectValue>{(v: string) => DOC_TYPE_LABEL[v as VendorDocType] ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>{DOC_TYPE_LABEL[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {DATED(type) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="doc-effective">Effective</Label>
            <Input id="doc-effective" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-expires">Expires</Label>
            <Input id="doc-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            <p className="text-xs text-muted-foreground">A task is raised 30 days before this date.</p>
          </div>
        </div>
      )}

      {(INSURED(type) || type === "LICENSE" || type === "WC_EXEMPTION") && (
        <div className="grid gap-3 sm:grid-cols-2">
          {INSURED(type) && (
            <div className="space-y-1.5">
              <Label htmlFor="doc-carrier">Carrier</Label>
              <Input id="doc-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} maxLength={200} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="doc-number">{type === "LICENSE" ? "License number" : type === "WC_EXEMPTION" ? "Exemption number" : "Policy number"}</Label>
            <Input id="doc-number" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} maxLength={120} />
          </div>
        </div>
      )}

      {!editing && (
        <div className="space-y-1.5">
          <Label htmlFor="doc-file">File (optional)</Label>
          <Input
            id="doc-file"
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              const problem = picked ? uploadProblem(picked) : null;
              if (problem) {
                toast.error(problem);
                e.target.value = "";
                return setFile(null);
              }
              setFile(picked);
            }}
          />
          <p className="text-xs text-muted-foreground">{file ? `${file.name} · ${formatFileSize(file.size)}` : "The dates can be recorded now and the paper added later as a new document."}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="doc-notes">Notes</Label>
        <Textarea id="doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save" : "Add document"}</Button>
      </DialogFooter>
    </form>
  );
}
