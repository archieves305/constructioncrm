"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, Lock, MinusCircle } from "lucide-react";
import { Callout } from "@/components/shared/callout";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { docLabel } from "@/lib/partners/package-plan";

type Item = { requirementId: string; typeName: string; required: boolean; included: boolean; reason: string | null; note: string | null; restricted: boolean; doc: { id: string; title: string; version: number } | null };
type Preview = { items: Item[]; included: number; leftOut: number; requiredMissing: number; restrictedWithheld: number; organizationName: string; canReadRestricted: boolean; fileName: string };

/**
 * Assemble the GC's prequalification package: what goes in, what does not and
 * why, then one zip with a contents sheet. Nothing is sent from here — the
 * person downloads it and sends it the way the GC asks.
 */
export function PackageDialog({ qualificationId, open, onOpenChange }: { qualificationId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [restricted, setRestricted] = useState(false);
  const qs = `restricted=${restricted ? 1 : 0}`;
  const preview = useQuery<Preview>({ queryKey: ["partners", "package", qualificationId, restricted], queryFn: () => fetchJson(`/api/qualifications/${qualificationId}/package?preview=1&${qs}`), retry: retryServerErrors, enabled: open });
  const p = preview.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Prequalification package{p ? ` for ${p.organizationName}` : ""}</DialogTitle>
          <DialogDescription>One zip of the vault documents this checklist asks for, with a contents sheet. Only documents approved for sending, in date and on file go in.</DialogDescription>
        </DialogHeader>
        {preview.isLoading ? (
          <ListSkeleton rows={4} />
        ) : preview.isError ? (
          <Callout tone="danger">{(preview.error as Error).message}</Callout>
        ) : p ? (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1.5">
              {p.items.map((i) => (
                <li key={i.requirementId} className="flex items-start gap-2">
                  {i.included ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-tone-success-fg" aria-label="Included" /> : <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Left out" />}
                  <div className="min-w-0">
                    <p className={i.included ? "" : "text-muted-foreground"}>
                      {i.typeName}
                      {!i.required && <span className="text-xs"> (optional)</span>}
                      {i.restricted && <Lock className="ml-1 inline size-3" aria-label="Restricted" />}
                      {i.included && i.doc && <span className="text-xs text-muted-foreground"> — {docLabel(i.doc.title, i.doc.version)}</span>}
                    </p>
                    {i.reason && <p className="text-xs text-muted-foreground">Left out: {i.reason}</p>}
                    {i.note && <p className="text-xs text-amber-700">{i.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
            {p.canReadRestricted && (
              <label className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2">
                <Checkbox checked={restricted} onCheckedChange={(c) => setRestricted(Boolean(c))} />
                Include restricted documents (financials, banking, tax forms) — each one is logged
              </label>
            )}
            {p.requiredMissing > 0 && <Callout tone="warning">{p.requiredMissing} required item{p.requiredMissing === 1 ? "" : "s"} will be listed as “to follow” on the contents sheet.</Callout>}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {p && p.included > 0 ? (
            <Button nativeButton={false} render={<a href={`/api/qualifications/${qualificationId}/package?${qs}`} download={p.fileName} />}>
              <Download className="mr-1.5 size-4" /> Download {p.included} document{p.included === 1 ? "" : "s"}
            </Button>
          ) : (
            <Button disabled>Nothing to send yet</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
