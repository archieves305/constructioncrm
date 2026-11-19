"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const ACCEPT = ".pdf,.docx,.xlsx,.csv,image/png,image/jpeg,image/webp,image/gif";

/** Upload Estimate: the proposal plus anything that helps read it; opens the review. */
export function UploadEstimateButton({ projectId, variant = "brand", label = "Upload estimate" }: { projectId?: string; variant?: "brand" | "outline"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}><Upload className="mr-1.5 size-4" /> {label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">{open && <UploadForm projectId={projectId} onClose={() => setOpen(false)} />}</DialogContent>
      </Dialog>
    </>
  );
}

function UploadForm({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [supporting, setSupporting] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      for (const s of supporting) form.append("supporting", s);
      if (text.trim()) form.set("text", text.trim());
      if (projectId) form.set("projectId", projectId);
      const res = await fetch("/api/bid-proposals", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status})`);
      toast.success(body.duplicate ? "That file was uploaded before — opening it" : "Uploaded — reading it now");
      onClose();
      router.push(`/planhub/proposals/${body.versionId}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <DialogHeader>
        <DialogTitle>Upload estimate</DialogTitle>
        <DialogDescription>KNU&rsquo;s estimate or proposal (PDF, Word .docx, picture, .xlsx or CSV). The AI reads it; you check every value before anything is filed. Uploading does not mean it was sent.</DialogDescription>
      </DialogHeader>
      <Field label="Estimate or proposal" id="u-file"><Input id="u-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></Field>
      <Field label="Also read (optional): the PlanHub invitation, a saved project page…" id="u-sup"><Input id="u-sup" type="file" accept={ACCEPT} multiple onChange={(e) => setSupporting(Array.from(e.target.files ?? []).slice(0, 5))} /></Field>
      <Field label="Or paste the invitation email (optional)" id="u-text"><Textarea id="u-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the GC's invitation or PlanHub project details" /></Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="brand" disabled={!file || busy}>{busy ? "Uploading…" : "Upload and read"}</Button>
      </DialogFooter>
    </form>
  );
}
