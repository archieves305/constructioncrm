"use client";

import { introCallsLine, type IntroCallToast } from "@/components/bids/intro-call-toast";
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { amountForScopes } from "@/lib/bids/proposal-plan";
import type { OrgDetail } from "@/components/partners/use-partners";
import { useBidProjectAction, usd, type ProjectDetail, type ProposalVersionRow } from "./use-bid-projects";

type Entry = { on: boolean; recipients: string[]; method: string; submittedAt: string; amount: string };
const METHODS = [{ value: "PLATFORM", label: "Through PlanHub" }, { value: "EMAIL", label: "By email" }, { value: "PORTAL", label: "GC's portal" }, { value: "HAND", label: "By hand" }, { value: "OTHER", label: "Other" }];

/**
 * "Send version vN to…": record that a checked version went out — one
 * submission per GC, with who received it. The amount per GC is computed
 * from the version's lines for the scopes that GC bids; a GC-specific
 * figure can be typed over it. Nothing is emailed from here.
 */
export function RecordSubmissionDialog({ project, version, open, onOpenChange }: { project: ProjectDetail; version: ProposalVersionRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const eligible = project.opportunities.filter((o) => o.status !== "CLOSED" && (!version.organizationId || o.organizationId === version.organizationId));
  const today = new Date().toISOString().slice(0, 10);
  const [entries, setEntries] = useState<Record<string, Entry>>(() => Object.fromEntries(eligible.map((o) => [o.id, { on: o.status === "READY_TO_SUBMIT", recipients: o.contactId ? [o.contactId] : [], method: "PLATFORM", submittedAt: today, amount: "" }])));
  const orgs = useQueries({ queries: eligible.map((o) => ({ queryKey: ["partners", "detail", o.organizationId], queryFn: () => fetchJson<OrgDetail>(`/api/partners/${o.organizationId}`), retry: retryServerErrors, enabled: open })) });
  const vLines = useMemo(() => ({ bundleAdjustment: version.bundleAdjustment ?? 0, lines: version.lines }), [version]);
  const save = useBidProjectAction<Record<string, unknown>, { submitted: { number: string; amount: number; introCall?: IntroCallToast }[] }>(`/api/bid-projects/${project.id}/submissions`, "POST", (r) => `Recorded as sent to ${r.submitted.length} GC(s)${introCallsLine(r.submitted.map((x) => x.introCall))}`);
  const chosen = eligible.filter((o) => entries[o.id]?.on);
  const set = (id: string, patch: Partial<Entry>) => setEntries((e) => ({ ...e, [id]: { ...e[id]!, ...patch } }));
  const missingRecipients = chosen.some((o) => entries[o.id]!.method === "EMAIL" && entries[o.id]!.recipients.length === 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              { versionId: version.id, entries: chosen.map((o) => { const x = entries[o.id]!; return { bidId: o.id, recipientContactIds: x.recipients, method: x.method, submittedAt: x.submittedAt, amount: x.amount ? Number(x.amount) : null }; }) },
              { onSuccess: () => onOpenChange(false) },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Record v{version.version} as sent</DialogTitle>
            <DialogDescription>Tick each GC that received this proposal and who it went to. Follow-ups start from these dates. The CRM sends nothing here.</DialogDescription>
          </DialogHeader>
          {eligible.length === 0 && <p className="text-sm text-muted-foreground">No open GC {version.organizationId ? "for this GC-specific version" : "on the project"} — add one first.</p>}
          <div className="space-y-2">
            {eligible.map((o, i) => {
              const x = entries[o.id]!;
              const computed = amountForScopes(vLines, o.scopes.map((s) => s.scope.id));
              const contacts = (orgs[i]?.data?.organization.contacts ?? []).filter((c) => c.isActive);
              return (
                <div key={o.id} className="space-y-2 rounded-md border p-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={x.on} onChange={(e) => set(o.id, { on: e.target.checked })} />
                    {o.organization.name} <span className="font-mono text-2xs text-muted-foreground">{o.number}</span>
                    <span className="text-xs font-normal text-muted-foreground">· {o.scopes.map((s) => s.scope.label).join(", ")} · {usd(computed)}</span>
                  </label>
                  {x.on && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Select items={METHODS} value={x.method} onValueChange={(v: string | null) => set(o.id, { method: v ?? "PLATFORM" })}>
                        <SelectTrigger className="w-full" aria-label="How it was sent"><SelectValue /></SelectTrigger>
                        <SelectContent>{METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input aria-label="Date sent" type="date" value={x.submittedAt} onChange={(e) => set(o.id, { submittedAt: e.target.value })} />
                      <Input aria-label="Amount sent (if different)" type="number" step="0.01" placeholder={`${computed}`} value={x.amount} onChange={(e) => set(o.id, { amount: e.target.value })} />
                      <div className="flex flex-wrap gap-1.5 sm:col-span-3">
                        {contacts.length === 0 && <span className="text-xs text-muted-foreground">No contacts at this GC yet.</span>}
                        {contacts.map((c) => {
                          const on = x.recipients.includes(c.id);
                          return (
                            <Button key={c.id} type="button" size="sm" variant={on ? "default" : "outline"} className="h-7 rounded-full text-xs" aria-pressed={on} onClick={() => set(o.id, { recipients: on ? x.recipients.filter((r) => r !== c.id) : [...x.recipients, c.id] })}>
                              {c.firstName} {c.lastName}{c.email ? "" : " (no email)"}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {missingRecipients && <p className="text-sm text-tone-danger-fg">Say who each emailed proposal went to.</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" disabled={chosen.length === 0 || missingRecipients || save.isPending}>Record as sent</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
