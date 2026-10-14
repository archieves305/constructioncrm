"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";
import { formatFileSize, uploadProblem } from "@/lib/files/limits";
import { CONFIDENTIALITY_HINT, CONFIDENTIALITY_LABEL } from "@/lib/partners/vault-access";
import { useInvalidatePartners, usePartnerOptions, type Confidentiality, type DocumentView, type Vault } from "./use-partners";

const addMonths = (day: string, months: number) => {
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/**
 * File a document in the vault, or a new version of one. The newest version
 * of a type is the one in force; earlier ones stay in the history and on the
 * qualifications that attached them until each is marked sent.
 */
export function VaultUploadDialog({
  open,
  onOpenChange,
  vault,
  initialTypeKey,
  replacing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: Pick<Vault, "canClassify" | "canReadRestricted">;
  initialTypeKey?: string;
  /** The version being replaced, to prefill title and dates. */
  replacing?: DocumentView | null;
  onSaved?: (doc: DocumentView) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {open && <UploadForm vault={vault} initialTypeKey={initialTypeKey} replacing={replacing ?? null} onSaved={onSaved} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({ vault, initialTypeKey, replacing, onSaved, onClose }: { vault: Pick<Vault, "canClassify" | "canReadRestricted">; initialTypeKey?: string; replacing: DocumentView | null; onSaved?: (doc: DocumentView) => void; onClose: () => void }) {
  const invalidate = useInvalidatePartners();
  const { data: options } = usePartnerOptions();
  const [typeKey, setTypeKey] = useState(replacing?.documentType.key ?? initialTypeKey ?? "");
  const [title, setTitle] = useState(replacing ? replacing.title.replace(/\s+v\d+$/, "") : "");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [confidentiality, setConfidentiality] = useState<Confidentiality>(replacing?.confidentiality ?? "INTERNAL");
  const [approvedForExternal, setApprovedForExternal] = useState(replacing?.approvedForExternal ?? false);
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const type = options?.documentTypes.find((t) => t.value === typeKey);
  const confItems = (options?.confidentialities ?? []).filter((c) => c.value !== "RESTRICTED" || vault.canReadRestricted);

  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("file", file!);
      form.set("documentTypeKey", typeKey);
      if (title.trim()) form.set("title", title.trim());
      form.set("effectiveDate", effectiveDate);
      form.set("expiresAt", expiresAt);
      form.set("confidentiality", confidentiality);
      form.set("approvedForExternal", approvedForExternal ? "true" : "false");
      form.set("notes", notes);
      return fetchJson<DocumentView>("/api/company-documents", { method: "POST", body: form });
    },
    onSuccess: (doc) => {
      invalidate();
      toast.success(`${doc.documentType.name} v${doc.version} filed`, doc.usedByCount ? { description: "Mark it sent on each qualification that used the old version." } : undefined);
      onSaved?.(doc);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!typeKey) return toast.error("Choose what kind of document this is");
        if (!file) return toast.error("Choose the file");
        if (effectiveDate && expiresAt && expiresAt < effectiveDate) return toast.error("The expiry date is before the effective date");
        save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{replacing ? `New version of ${replacing.documentType.name}` : "File a document"}</DialogTitle>
        <DialogDescription>{replacing ? `Replaces v${replacing.version} as the current one; v${replacing.version} stays in the history.` : "The newest version of each kind is the one in force."}</DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label>Kind</Label>
        <Select items={options?.documentTypes ?? []} value={typeKey} onValueChange={(v: string | null) => v && setTypeKey(v)} disabled={Boolean(replacing)}>
          <SelectTrigger className="w-full" aria-label="Document kind"><SelectValue placeholder="Choose a kind" /></SelectTrigger>
          <SelectContent>{(options?.documentTypes ?? []).map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vault-file">File</Label>
        <Input
          id="vault-file"
          type="file"
          accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? [])[0] ?? null;
            e.target.value = "";
            const problem = picked ? uploadProblem(picked) : null;
            if (problem) {
              toast.error(problem);
              return setFile(null);
            }
            setFile(picked);
          }}
        />
        <p className="text-xs text-muted-foreground">{file ? `${file.name} · ${formatFileSize(file.size)}` : "PDF, image or office file, up to 25 MB."}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vault-title">Title</Label>
        <Input id="vault-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type ? `${type.label} ${new Date().getFullYear()}` : "GL certificate 2026"} maxLength={200} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vault-effective">Effective</Label>
          <Input
            id="vault-effective"
            type="date"
            value={effectiveDate}
            onChange={(e) => {
              setEffectiveDate(e.target.value);
              if (e.target.value && !expiresAt && type?.defaultValidityMonths) setExpiresAt(addMonths(e.target.value, type.defaultValidityMonths));
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vault-expires">Expires</Label>
          <Input id="vault-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          <p className="text-xs text-muted-foreground">{type?.defaultValidityMonths ? `Usually ${type.defaultValidityMonths} months. A task is raised 30 days before.` : "Leave empty for a document that does not run out."}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Who may open it</Label>
        <Select items={confItems} value={confidentiality} onValueChange={(v: Confidentiality | null) => v && setConfidentiality(v)}>
          <SelectTrigger className="w-full" aria-label="Confidentiality"><SelectValue /></SelectTrigger>
          <SelectContent>{confItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{CONFIDENTIALITY_HINT[confidentiality]}</p>
      </div>

      {vault.canClassify && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={approvedForExternal} onChange={(e) => setApprovedForExternal(e.target.checked)} />
          <span>
            Approved for external distribution
            <span className="block text-xs text-muted-foreground">This exact file may go to a GC as part of a qualification package.</span>
          </span>
        </label>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="vault-notes">Notes</Label>
        <Textarea id="vault-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Carrier, policy number, who issued it" />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Filing…" : `File as ${CONFIDENTIALITY_LABEL[confidentiality].toLowerCase()}`}</Button>
      </DialogFooter>
    </form>
  );
}
