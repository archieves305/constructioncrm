"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, FileDown, ListPlus, OctagonAlert, PlayCircle, ShieldCheck, Sparkles, TriangleAlert, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/shared/callout";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { Finding, Severity } from "@/lib/permit-intel/preflight";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { permitIntelKeys } from "./use-permit-intel";
import type { PermitDetail } from "./types";

type Run = { id: string; cycleNumber: number; rulesVersion: string; score: number; blockers: number; warnings: number; findings: Finding[]; aiCallId: string | null; createdAt: string; ranBy: { firstName: string; lastName: string } | null };
type PreflightData = {
  runs: Run[];
  ready: { readyAt: string | null; readyRunId: string | null; readyOverride: string | null; readyBy: { firstName: string; lastName: string } | null } | null;
  scoreLabel: string;
  permissions: { canRun: boolean; canMarkReady: boolean; canOverride: boolean; aiReady: boolean };
};

const preflightKey = (permitId: string) => ["permit", permitId, "preflight"] as const;
const GROUP: { severity: Severity; title: string; tone: "danger" | "warning" | "info"; icon: typeof OctagonAlert }[] = [
  { severity: "BLOCKER", title: "Blockers", tone: "danger", icon: OctagonAlert },
  { severity: "WARNING", title: "Warnings", tone: "warning", icon: TriangleAlert },
  { severity: "INFO", title: "For information", tone: "info", icon: Info },
];
const TAB_LABEL: Record<string, string> = { documents: "Documents", forms: "Forms", products: "Products", parties: "Parties", corrections: "Corrections", overview: "Overview", submissions: "Submissions" };

/**
 * Preflight: is the package ready for the building department? Rules over the
 * records, and an optional AI second look that only adds warnings. The score
 * is a readiness score, not a prediction of approval. "Mark ready to submit"
 * takes zero blockers, or an administrator's or manager's override with a
 * reason.
 */
export function PermitPreflight({ detail }: { detail: PermitDetail }) {
  const { permit } = detail;
  const qc = useQueryClient();
  const url = useSearchParamState();
  const { data, isLoading, error } = useQuery({ queryKey: preflightKey(permit.id), queryFn: () => fetchJson<PreflightData>(`/api/permits/${permit.id}/preflight`), retry: retryServerErrors });
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState<"run" | "ready" | "tasks" | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<"ready" | "override" | "clear" | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  if (isLoading) return <ListSkeleton rows={4} />;
  if (error || !data) return <Callout tone="danger" title="Preflight did not load">{(error as Error | null)?.message ?? "Try again."}</Callout>;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: preflightKey(permit.id) });
    qc.invalidateQueries({ queryKey: permitIntelKeys.permit(permit.id), exact: true });
    qc.invalidateQueries({ queryKey: ["tasks-v2"] });
  };
  const call = async <T,>(what: typeof busy, url: string, init: RequestInit, ok?: string): Promise<T | null> => {
    setBusy(what);
    try {
      const r = await fetchJson<T>(url, init);
      if (ok) toast.success(ok);
      refresh();
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const run = data.runs.find((r) => r.id === shown) ?? data.runs[0] ?? null;
  const ready = data.ready?.readyAt ? data.ready : null;
  const latest = data.runs[0] ?? null;
  const p = data.permissions;
  const actionable = run ? run.findings.filter((f) => f.severity !== "INFO") : [];

  return (
    <div className="space-y-4">
      {ready && (
        <Callout tone={ready.readyOverride ? "warning" : "success"} icon={ShieldCheck} title={`Marked ready to submit ${format(new Date(ready.readyAt!), "MMM d, yyyy h:mm a")}${ready.readyBy ? ` by ${ready.readyBy.firstName} ${ready.readyBy.lastName}` : ""}`}
          action={p.canMarkReady ? <Button size="sm" variant="ghost" onClick={() => setConfirm("clear")}>Take it off</Button> : undefined}>
          {ready.readyOverride ? `Over its blockers: ${ready.readyOverride}` : "Freezing the package clears this, so the next submission is checked again."}
        </Callout>
      )}

      <Card className="min-w-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm">Check the package</CardTitle>
          {p.canRun && (
            <div className="flex flex-wrap items-center gap-3">
              <label className={cn("flex items-center gap-2 text-sm", !p.aiReady && "opacity-60")}>
                <Checkbox checked={ai} disabled={!p.aiReady} onCheckedChange={(v) => setAi(v === true)} />
                <Sparkles className="size-3.5" /> with an AI second look
              </label>
              <Button size="sm" variant="brand" disabled={!!busy} onClick={() => call("run", `/api/permits/${permit.id}/preflight`, json("POST", { ai }), "Checked").then((r) => r && setShown(null))}>
                <PlayCircle className="size-3.5" /> {busy === "run" ? (ai ? "Checking — the AI takes a minute…" : "Checking…") : "Run preflight"}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          The documents the jurisdiction asks for, the application forms, signatures to collect, the licence on record, products and their approvals, open corrections. The AI look only adds warnings, from a summary — no document, phone or email is sent.
        </CardContent>
      </Card>

      {!run ? (
        <EmptyState icon={CircleCheck} title="Not checked yet" description="Run preflight before freezing the package. Each run is kept, so you can see what changed." />
      ) : (
        <Card className="min-w-0">
          <CardHeader className="space-y-2 pb-2">
            <div className="flex flex-wrap items-center gap-4">
              <div className={cn("text-3xl font-semibold tabular-nums", run.blockers ? "text-tone-danger-fg" : run.warnings ? "text-tone-warning-fg" : "text-tone-success-fg")}>{run.score}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {run.blockers} blocker{run.blockers === 1 ? "" : "s"} · {run.warnings} warning{run.warnings === 1 ? "" : "s"}
                  {run.findings.some((f) => f.source === "ai") ? <span className="font-normal text-muted-foreground"> · {run.findings.filter((f) => f.source === "ai").length} from the AI look, not scored</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.scoreLabel}. {format(new Date(run.createdAt), "MMM d, h:mm a")}
                  {run.ranBy ? ` by ${run.ranBy.firstName} ${run.ranBy.lastName}` : ""} · rules {run.rulesVersion}
                  {run.aiCallId ? " · with the AI look" : ""}
                  {run !== latest ? " · an earlier run" : ""}
                </p>
              </div>
              <Button size="sm" variant="outline" render={<a href={`/api/permit-preflight-runs/${run.id}/pdf`} target="_blank" rel="noreferrer" />} nativeButton={false}>
                <FileDown className="size-3.5" /> Report
              </Button>
            </div>
            {run === latest && p.canMarkReady && !ready && (
              <div className="flex flex-wrap gap-2">
                {run.blockers === 0 ? (
                  <Button size="sm" variant="brand" disabled={!!busy} onClick={() => setConfirm("ready")}>
                    <ShieldCheck className="size-3.5" /> Mark ready to submit
                  </Button>
                ) : (
                  p.canOverride && (
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setConfirm("override")}>
                      <ShieldCheck className="size-3.5" /> Mark ready over the blockers…
                    </Button>
                  )
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {run.findings.length === 0 && <p className="text-sm text-tone-success-fg">Nothing found against the records.</p>}
            {GROUP.map((g) => {
              const items = run.findings.filter((f) => f.severity === g.severity);
              if (!items.length) return null;
              const Icon = g.icon;
              return (
                <section key={g.severity} className="min-w-0">
                  <h3 className={cn("mb-1 text-[11px] font-semibold uppercase tracking-wide", toneClasses(g.tone).text)}>
                    {g.title} ({items.length})
                  </h3>
                  <ul className="divide-y rounded-md border">
                    {items.map((f) => (
                      <li key={f.code} className="flex items-start gap-2 px-3 py-2">
                        {g.severity !== "INFO" && run === latest && p.canRun ? (
                          <Checkbox
                            className="mt-0.5"
                            aria-label={`Pick “${f.message}” for a task`}
                            checked={picked.has(f.code)}
                            onCheckedChange={(v) =>
                              setPicked((s) => {
                                const n = new Set(s);
                                if (v === true) n.add(f.code);
                                else n.delete(f.code);
                                return n;
                              })
                            }
                          />
                        ) : (
                          <Icon className={cn("mt-0.5 size-4 shrink-0", toneClasses(g.tone).text)} />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            {f.source === "ai" && <Sparkles className="mr-1 inline size-3.5 text-muted-foreground" aria-label="from the AI look" />}
                            {f.message}
                          </p>
                          {f.suggestion && <p className="text-xs text-muted-foreground">{f.suggestion}</p>}
                          {f.evidence?.map((e) => (
                            <button key={e.ref} type="button" className="mr-2 text-xs text-primary hover:underline" onClick={() => url.set("tab", e.ref)}>
                              Open {TAB_LABEL[e.ref] ?? e.label}
                            </button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {run === latest && p.canRun && actionable.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(actionable.map((f) => f.code)))}>
                  Pick all
                </Button>
                <Button size="sm" variant="outline" disabled={!picked.size || !!busy} onClick={() => call<{ created: number }>("tasks", `/api/permit-preflight-runs/${run.id}/tasks`, json("POST", { codes: [...picked] })).then((r) => r && (toast.success(`${r.created} task${r.created === 1 ? "" : "s"} for the permit's coordinator`), setPicked(new Set())))}>
                  <ListPlus className="size-3.5" /> Create {picked.size || ""} task{picked.size === 1 ? "" : "s"}
                </Button>
                <span className="text-xs text-muted-foreground">Each closes by itself when a later run passes it.</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.runs.length > 1 && (
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Earlier runs</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y rounded-md border text-sm">
              {data.runs.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setShown(r.id)} className={cn("flex w-full flex-wrap items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50", run?.id === r.id && "bg-muted")}>
                    <span className="w-8 font-semibold tabular-nums">{r.score}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(r.createdAt), "MMM d, h:mm a")} · {r.blockers} blocker{r.blockers === 1 ? "" : "s"}, {r.warnings} warning{r.warnings === 1 ? "" : "s"} · {r.cycleNumber ? `cycle ${r.cycleNumber}` : "before submitting"}
                      {r.aiCallId ? " · AI" : ""}
                      {data.ready?.readyRunId === r.id ? " · marked ready" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirm === "ready"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Mark ready to submit?"
        description="The checks run once more first. The job's “Assemble permit documents” step ticks itself; freezing the package clears the mark."
        confirmLabel="Mark ready"
        pending={busy === "ready"}
        onConfirm={async () => void (await call("ready", `/api/permits/${permit.id}/ready`, json("POST", {}), "Marked ready to submit"))}
      />
      <ConfirmDialog
        open={confirm === "override"}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="warning"
        title="Mark ready over the blockers?"
        description={`${run?.blockers ?? 0} blocker${run?.blockers === 1 ? "" : "s"} stand. Say why they do not apply; the reason is kept with the permit and printed on the report.`}
        requireReason={{ minLength: 10 }}
        reasonLabel="Why"
        confirmLabel="Mark ready"
        pending={busy === "ready"}
        onConfirm={async (reason) => void (await call("ready", `/api/permits/${permit.id}/ready`, json("POST", { overrideReason: reason }), "Marked ready to submit"))}
      />
      <ConfirmDialog
        open={confirm === "clear"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Take the ready mark off?"
        confirmLabel="Take it off"
        pending={busy === "ready"}
        onConfirm={async () => void (await call("ready", `/api/permits/${permit.id}/ready`, { method: "DELETE" }, "No longer marked ready"))}
      />
    </div>
  );
}
