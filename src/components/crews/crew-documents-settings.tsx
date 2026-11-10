"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/fetch-json";
import { useSession } from "@/lib/auth/session-client";

/** Every kind of job file, in the words the Files tab uses. */
const KINDS: { value: string; label: string }[] = [
  { value: "PLAN_SET", label: "Plan sets" },
  { value: "PHOTOS", label: "Photos" },
  { value: "VIDEO", label: "Videos" },
  { value: "PERMIT", label: "Permits" },
  { value: "INSPECTION", label: "Inspections" },
  { value: "MEASUREMENT_REPORT", label: "Roof measurement reports" },
  { value: "OTHER", label: "Other documents" },
  { value: "ESTIMATE", label: "Estimates" },
  { value: "CUSTOMER_CONTRACT", label: "Customer contracts" },
  { value: "SIGNED_DOC", label: "Signed documents" },
  { value: "CONTRACT_ADDENDUM", label: "Contract addenda" },
  { value: "LABOR_CONTRACT", label: "Labor contracts" },
  { value: "INTERIOR_RENOVATION_LABOR_CONTRACT", label: "Interior labor contracts" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "RECEIPT", label: "Receipts" },
];

type Setting = { categories: string[]; neverShown: string[] };

/**
 * What crew leads can open on a job's Files tab and in the phone app. An
 * admin ticks the kinds of file; one file can still be shown or hidden from
 * its row on the Files tab. Contracts, estimates, receipts and insurance are
 * never shown by kind.
 */
export function CrewDocumentsSettings() {
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "ADMIN";
  const qc = useQueryClient();
  const q = useQuery<Setting>({ queryKey: ["crew-documents"], queryFn: () => fetchJson("/api/admin/crew-documents") });
  const [draft, setDraft] = useState<string[] | null>(null);
  const chosen = draft ?? q.data?.categories ?? [];
  const save = useMutation({
    mutationFn: (categories: string[]) => fetchJson<Setting>("/api/admin/crew-documents", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categories }) }),
    onSuccess: (data) => {
      qc.setQueryData(["crew-documents"], data);
      setDraft(null);
      toast.success("Saved. Crews see these kinds of file from now on.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What crews can see</CardTitle>
        <p className="text-sm text-muted-foreground">
          The kinds of job file a crew lead can open, on the Files tab and in KNU Field. To show or hide one file on its own, use its row menu on the job&apos;s Files tab.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isPending ? (
          <Skeleton className="h-32" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((k) => {
              const never = q.data?.neverShown.includes(k.value) ?? false;
              const id = `crew-kind-${k.value}`;
              return (
                <label key={k.value} htmlFor={id} className="flex min-h-9 items-center gap-2 text-sm">
                  <Checkbox
                    id={id}
                    checked={!never && chosen.includes(k.value)}
                    disabled={never || !isAdmin}
                    onCheckedChange={(on) => setDraft(on ? [...chosen, k.value] : chosen.filter((c) => c !== k.value))}
                  />
                  <span className={never ? "text-muted-foreground" : undefined}>
                    {k.label}
                    {never ? " · never by kind" : ""}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {isAdmin ? (
          <div className="flex justify-end gap-2">
            {draft ? (
              <Button variant="outline" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            ) : null}
            <Button disabled={!draft} loading={save.isPending} onClick={() => draft && save.mutate(draft)}>
              Save
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Only an admin can change this.</p>
        )}
      </CardContent>
    </Card>
  );
}
