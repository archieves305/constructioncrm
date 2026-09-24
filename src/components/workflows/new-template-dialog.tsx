"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";
import { slugKey } from "@/lib/workflows/slug";

/** A new, empty trade template (v1 draft). */
export function NewTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () =>
      fetchJson<{ id: string }>("/api/admin/workflow-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim(), name: name.trim(), kind: "TRADE", trade: name.trim(), description: description.trim() || null }),
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["admin-workflow-templates"] });
      qc.invalidateQueries({ queryKey: ["workflow-templates"] });
      toast.success("Template created — add phases and steps, then publish");
      onOpenChange(false);
      router.push(`/admin/workflow-templates/${t.id}`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not create the template"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New trade template</DialogTitle>
          <DialogDescription>Starts as an empty draft. It is offered when applying a workflow only once a version is published.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="nt-name" className="text-xs">
              Name
            </Label>
            <Input id="nt-name" autoFocus className="mt-1" value={name} placeholder="e.g. Siding" onChange={(e) => { setName(e.target.value); setKey(slugKey(e.target.value)); }} />
          </div>
          <div>
            <Label htmlFor="nt-key" className="text-xs">
              Key
            </Label>
            <Input id="nt-key" className="mt-1 font-mono text-xs" value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="nt-desc" className="text-xs">
              Description (optional)
            </Label>
            <Textarea id="nt-desc" rows={2} className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={create.isPending || !name.trim() || !key.trim()} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create template"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
