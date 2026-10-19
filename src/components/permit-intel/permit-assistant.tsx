"use client";

import { useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleDashed, ExternalLink, FileText, Globe, Link2, Loader2, Sparkles, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Callout } from "@/components/shared/callout";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { formatFileSize, uploadProblem } from "@/lib/files/limits";
import type { Ask, CoverageLine, Findings } from "@/lib/permit-intel/assist-plan";
import { permitDocLabel } from "@/lib/permit-intel/doc-types";
import { cn } from "@/lib/utils";
import { DocTypeSelect, uploadOne } from "./permit-documents";

type Item = {
  id: string;
  source: "UPLOAD" | "LINK" | "SITE";
  parentItemId: string | null;
  depth: number;
  reason: string | null;
  linkText: string | null;
  url: string | null;
  finalUrl: string | null;
  fileId: string | null;
  fileName: string | null;
  fileType: string | null;
  sizeBytes: number | null;
  status: "QUEUED" | "READING" | "PROPOSED" | "ACCEPTED" | "REJECTED" | "PAGE" | "FAILED";
  error: string | null;
  suggestedType: string | null;
  decidedType: string | null;
  title: string | null;
  summary: string | null;
  findings: Findings | null;
  approvalId: string | null;
  hasBytes: boolean;
  duplicateOf: string | null;
};
type Fetch = { id: string; url: string; finalUrl: string | null; httpStatus: number | null; outcome: string; note: string | null; bytes: number | null };
type AssistData = {
  website: string | null;
  jurisdiction: string | null;
  untypedOnPermit: number;
  aiReady: boolean;
  canRun: boolean;
  run: null | {
    id: string;
    status: "RUNNING" | "DONE";
    fetchCount: number;
    maxFetches: number;
    createdAt: string;
    finishedAt: string | null;
    startedBy: { firstName: string; lastName: string } | null;
    spentUsd: number;
    items: Item[];
    fetches: Fetch[];
    coverage: CoverageLine[];
    asks: Ask[];
    approvalNumbers: { number: string; itemId: string; page: number | null; quote: string }[];
  };
};

const key = (permitId: string) => ["permit-assist", permitId] as const;

/**
 * The permit document assistant: hand it documents (and the building
 * department's website), it reads them, opens the links worth opening, and
 * proposes a type for each against the checklist. Nothing joins the permit
 * until someone accepts it here.
 */
export function PermitAssistant({ permitId, onChanged }: { permitId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: key(permitId),
    queryFn: () => fetchJson<AssistData>(`/api/permits/${permitId}/assist`),
    retry: retryServerErrors,
    refetchInterval: (q) => (q.state.data?.run?.status === "RUNNING" ? 3_000 : false),
  });
  const [starting, setStarting] = useState(false);
  if (error) return <Callout tone="danger" title="Couldn't load the assistant">{(error as Error).message}</Callout>;
  if (!data) return null;
  const run = data.run;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key(permitId) });
    onChanged();
  };

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Sparkles className="size-4 text-primary" /> Document assistant
          </CardTitle>
          <p className="text-xs text-muted-foreground">Hand it a pile of documents. It reads each one, opens the links worth opening, looks on the building department&apos;s website if you ask, and proposes what goes in the package. Nothing joins the permit until you accept it.</p>
        </div>
        {data.canRun && (
          <Button size="sm" variant="brand" disabled={!data.aiReady || run?.status === "RUNNING"} onClick={() => setStarting(true)}>
            <Sparkles className="size-3.5" /> {run ? "Another pass…" : "Sort documents…"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {!data.aiReady && <p className="text-xs text-muted-foreground">AI is not set up on this server.</p>}
        {run ? <RunView run={run} canDecide={data.canRun} onDecided={refresh} /> : null}
      </CardContent>
      <Dialog open={starting} onOpenChange={setStarting}>
        <DialogContent className="sm:max-w-lg">{starting && <StartForm permitId={permitId} data={data} onDone={() => (setStarting(false), refresh())} />}</DialogContent>
      </Dialog>
    </Card>
  );
}

function StartForm({ permitId, data, onDone }: { permitId: string; data: AssistData; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [includeUntyped, setIncludeUntyped] = useState(data.untypedOnPermit > 0);
  const [searchSite, setSearchSite] = useState(!!data.website);
  const [busy, setBusy] = useState<string | null>(null);
  const add = (list: FileList | null) => {
    const chosen = list ? Array.from(list) : [];
    if (input.current) input.current.value = "";
    for (const f of chosen) {
      const p = uploadProblem(f);
      if (p) toast.error(p);
    }
    setFiles((cur) => [...cur, ...chosen.filter((f) => !uploadProblem(f))]);
  };
  const start = async () => {
    const fileIds: string[] = [];
    for (const [n, f] of files.entries()) {
      setBusy(`Uploading ${n + 1} of ${files.length}…`);
      try {
        const rec = await uploadOne(permitId, f, null);
        fileIds.push((rec as { id: string }).id);
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      }
    }
    setBusy("Starting…");
    try {
      await fetchJson(`/api/permits/${permitId}/assist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds, includeUntyped, searchSite }) });
      toast.success("The assistant is reading — this page updates as it goes");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
      if (fileIds.length) onDone();
    } finally {
      setBusy(null);
    }
  };
  const nothing = !files.length && !(includeUntyped && data.untypedOnPermit) && !searchSite;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Sort documents with the assistant</DialogTitle>
        <DialogDescription>Uploaded documents are added to the permit without a type; the assistant proposes one for each, and anything it finds online waits for you.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <input ref={input} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp,.doc,.docx,.xls,.xlsx,.txt" className="hidden" onChange={(e) => add(e.target.files)} />
        <button
          type="button"
          className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground hover:bg-muted/40"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            add(e.dataTransfer.files);
          }}
        >
          <Upload className="size-5" />
          Drop documents here, or choose them
          <span className="text-xs">PDFs and pictures are read; other files are added for you to type.</span>
        </button>
        {files.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                <span className="truncate">{f.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {formatFileSize(f.size)}
                  <button type="button" className="hover:text-foreground" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                    <XCircle className="size-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={includeUntyped} disabled={!data.untypedOnPermit} onCheckedChange={(v) => setIncludeUntyped(v === true)} />
          <span>
            Also read the {data.untypedOnPermit} document{data.untypedOnPermit === 1 ? "" : "s"} already on this permit without a type
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={searchSite} disabled={!data.website} onCheckedChange={(v) => setSearchSite(v === true)} />
          <span>
            Look on {data.jurisdiction ?? "the building department"}&apos;s website for forms and checklists
            {!data.website && <span className="block text-xs text-muted-foreground">Add the department&apos;s website under Admin → Permits → Jurisdictions first.</span>}
          </span>
        </label>
        <p className="text-xs text-muted-foreground">It opens links a document names, then only the department&apos;s own pages and the state and Miami-Dade product-approval sites — at most 40 pages a pass.</p>
      </div>
      <DialogFooter>
        <Button variant="brand" disabled={!!busy || nothing} onClick={start}>
          {busy ?? `Start${files.length ? ` with ${files.length} document${files.length === 1 ? "" : "s"}` : ""}`}
        </Button>
      </DialogFooter>
    </>
  );
}

const SOURCE_ICON = { UPLOAD: FileText, LINK: Link2, SITE: Globe } as const;

function sourceLine(i: Item, byId: Map<string, Item>): string {
  if (i.source === "UPLOAD") return "Uploaded";
  const parent = i.parentItemId ? byId.get(i.parentItemId) : null;
  const from = parent ? `“${parent.title ?? parent.fileName ?? parent.finalUrl ?? parent.url}”` : null;
  if (i.source === "SITE" && !parent) return "The building department's website";
  return `${i.source === "SITE" ? "On the department's site" : "Opened from a link"}${from ? ` in ${from}` : ""}${i.linkText ? ` — “${i.linkText}”` : ""}`;
}

function RunView({ run, canDecide, onDecided }: { run: NonNullable<AssistData["run"]>; canDecide: boolean; onDecided: () => void }) {
  const byId = new Map(run.items.map((i) => [i.id, i]));
  const proposed = run.items.filter((i) => i.status === "PROPOSED");
  const decided = run.items.filter((i) => i.status === "ACCEPTED" || i.status === "REJECTED");
  const failed = run.items.filter((i) => i.status === "FAILED");
  const pages = run.items.filter((i) => i.status === "PAGE");
  const busy = run.items.filter((i) => i.status === "QUEUED" || i.status === "READING");
  const done = run.items.length - busy.length;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {run.status === "RUNNING" ? (
            <span className="inline-flex items-center gap-1 text-foreground">
              <Loader2 className="size-3 animate-spin" /> Reading {done} of {run.items.length}
            </span>
          ) : (
            <>Finished {run.finishedAt ? formatDistanceToNow(new Date(run.finishedAt), { addSuffix: true }) : ""}</>
          )}{" "}
          · {run.fetchCount} of {run.maxFetches} web pages opened · AI ${run.spentUsd.toFixed(2)}
          {run.startedBy ? ` · started by ${run.startedBy.firstName} ${run.startedBy.lastName}` : ""}
        </p>
        {run.status === "RUNNING" && <Progress value={done} max={run.items.length} label="Assistant progress" className="h-1.5" />}
      </div>

      <Section title={`To decide (${proposed.length})`} open>
        {proposed.length === 0 ? (
          <p className="text-xs text-muted-foreground">{run.status === "RUNNING" ? "Proposals appear here as each document is read." : "Nothing waiting."}</p>
        ) : (
          <ul className="divide-y">
            {proposed.map((i) => (
              <ProposedRow key={i.id} item={i} byId={byId} canDecide={canDecide} onDecided={onDecided} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="The checklist" open>
        {run.coverage.length === 0 ? (
          <p className="text-xs text-muted-foreground">No requirements are set for this jurisdiction and permit type yet — see what the documents ask for below.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {run.coverage.map((l) => (
              <li key={l.requirement.id} className="flex items-start gap-2">
                {l.state === "covered" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-tone-success-fg" /> : l.state === "proposed" ? <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" /> : l.state === "missing" ? <CircleAlert className={cn("mt-0.5 size-4 shrink-0", l.requirement.required ? "text-tone-danger-fg" : "text-muted-foreground")} /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0">
                  {l.requirement.title}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {l.state === "covered" ? `— on file (${l.files.map((f) => f.fileName).join(", ")})` : l.state === "proposed" ? `— proposed: ${l.items.map((x) => x.title ?? x.fileName).join(", ")}` : l.state === "missing" ? (l.requirement.required ? "— missing" : "— not on file (optional)") : "— check by hand"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {run.asks.some((a) => a.fromYourDocuments) && (
        <Section title={`What your documents ask for (${run.asks.filter((a) => a.fromYourDocuments).length})`} open>
          <AskList asks={run.asks.filter((a) => a.fromYourDocuments)} />
        </Section>
      )}
      {run.asks.some((a) => !a.fromYourDocuments) && (
        <Section title={`Also mentioned on the department's pages and forms (${run.asks.filter((a) => !a.fromYourDocuments).length})`}>
          <AskList asks={run.asks.filter((a) => !a.fromYourDocuments)} />
        </Section>
      )}

      {run.approvalNumbers.length > 0 && (
        <Section title={`Product approvals named (${run.approvalNumbers.length})`}>
          <ul className="space-y-1 text-sm">
            {run.approvalNumbers.map((a) => (
              <li key={a.number}>
                <a className="text-primary hover:underline" href={`/permits/products?q=${encodeURIComponent(a.number)}`}>
                  {a.number}
                </a>
                <span className="ml-1 text-xs text-muted-foreground">
                  in {byId.get(a.itemId)?.title ?? byId.get(a.itemId)?.fileName}
                  {a.page ? `, p. ${a.page}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {decided.length > 0 && (
        <Section title={`Decided (${decided.length})`}>
          <ul className="space-y-1 text-sm">
            {decided.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                {i.status === "ACCEPTED" ? <CheckCircle2 className="size-4 text-tone-success-fg" /> : <XCircle className="size-4 text-muted-foreground" />}
                <span className="truncate">{i.title ?? i.fileName}</span>
                <span className="text-xs text-muted-foreground">{i.status === "ACCEPTED" ? `on the permit as ${permitDocLabel(i.decidedType)}` : "rejected"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(failed.length > 0 || pages.length > 0 || run.fetches.length > 0) && (
        <Section title={`Pages and links (${run.fetches.length} opened or refused${failed.length ? `, ${failed.length} not read` : ""})`}>
          <div className="space-y-3 text-xs">
            {failed.length > 0 && (
              <ul className="space-y-1">
                {failed.map((i) => (
                  <li key={i.id} className="min-w-0">
                    <span className="font-medium">{i.title ?? i.fileName ?? i.linkText ?? i.url}</span>
                    <span className="block break-all text-muted-foreground">{i.error}</span>
                  </li>
                ))}
              </ul>
            )}
            {pages.length > 0 && (
              <ul className="space-y-1">
                {pages.map((i) => (
                  <li key={i.id} className="min-w-0">
                    <a className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href={i.finalUrl ?? i.url ?? "#"} target="_blank" rel="noreferrer noopener">
                      {i.title ?? i.finalUrl} <ExternalLink className="size-3" />
                    </a>
                    {i.summary && <span className="block text-muted-foreground">{i.summary}</span>}
                  </li>
                ))}
              </ul>
            )}
            <ul className="space-y-0.5 text-muted-foreground">
              {run.fetches.map((f) => (
                <li key={f.id} className="break-all">
                  <span className={cn("mr-1 font-medium", f.outcome === "OK" ? "text-tone-success-fg" : f.outcome === "REFUSED" ? "text-tone-warning-fg" : "text-tone-danger-fg")}>{f.outcome === "OK" ? "opened" : f.outcome === "REFUSED" ? "refused" : "failed"}</span>
                  {f.finalUrl ?? f.url}
                  {f.note ? ` — ${f.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}
    </div>
  );
}

function AskList({ asks }: { asks: Ask[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {asks.map((a, n) => (
        <li key={n} className="min-w-0">
          <span className={cn(a.onFile && "text-muted-foreground line-through decoration-muted-foreground/50")}>{a.what}</span>
          {a.onFile ? <span className="ml-1 text-xs text-tone-success-fg">on file</span> : a.onChecklist ? <span className="ml-1 text-xs text-muted-foreground">on the checklist</span> : <span className="ml-1 text-xs text-tone-warning-fg">not on the checklist</span>}
          <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
            {a.sources.slice(0, 3).map((s, k) => (
              <li key={k} className="truncate">
                {s.title}
                {s.page ? `, p. ${s.page}` : ""}: “{s.quote}”
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, open: initial = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="min-w-0">
      <button type="button" className="mb-1 inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} {title}
      </button>
      {open && children}
    </div>
  );
}

function ProposedRow({ item: i, byId, canDecide, onDecided }: { item: Item; byId: Map<string, Item>; canDecide: boolean; onDecided: () => void }) {
  const [type, setType] = useState<string | null>(i.suggestedType);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const Icon = SOURCE_ICON[i.source];
  const dup = i.duplicateOf ? byId.get(i.duplicateOf) : null;
  const decide = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await fetchJson(`/api/permit-assist-items/${i.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      toast.success(done);
      onDecided();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const asks = i.findings?.asks?.length ?? 0;
  return (
    <li className="space-y-1.5 py-3">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{i.title ?? i.fileName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {sourceLine(i, byId)}
            {i.fileName && i.title ? ` · ${i.fileName}` : ""}
            {i.sizeBytes ? ` · ${formatFileSize(i.sizeBytes)}` : ""}
          </p>
          {i.reason && i.source !== "UPLOAD" && <p className="text-xs text-muted-foreground">Why: {i.reason}</p>}
        </div>
      </div>
      {dup && <p className="text-xs text-tone-warning-fg">Same file as “{dup.title ?? dup.fileName}” — probably reject this copy.</p>}
      {i.findings && i.findings.relevant === false && <p className="text-xs text-tone-warning-fg">The assistant thinks this has nothing to do with the permit.</p>}
      {i.summary && (
        <p className={cn("text-xs text-muted-foreground", !more && "line-clamp-2")} onClick={() => setMore((m) => !m)}>
          {i.summary}
          {asks > 0 && ` It asks for ${asks} thing${asks === 1 ? "" : "s"} (listed below).`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <DocTypeSelect value={type} onChange={setType} disabled={!canDecide || busy} className="w-[220px]" />
        {canDecide && (
          <>
            <Button size="sm" variant="brand" disabled={busy || !type} onClick={() => decide({ action: "accept", docType: type }, `Added to the permit as ${permitDocLabel(type)}`)}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide({ action: "reject" }, i.source === "UPLOAD" ? "Left on the permit without a type" : "Rejected")}>
              Reject
            </Button>
          </>
        )}
        {i.hasBytes && (
          <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={`/api/permit-assist-items/${i.id}/file`} target="_blank" rel="noreferrer">
            Open <ExternalLink className="size-3" />
          </a>
        )}
        {(i.finalUrl ?? i.url) && (
          <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline" href={i.finalUrl ?? i.url!} target="_blank" rel="noreferrer noopener">
            Where it came from <ExternalLink className="size-3" />
          </a>
        )}
        {canDecide && i.fileType === "application/pdf" && (type === "product_approval" || i.suggestedType === "product_approval") && !i.approvalId && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide({ action: "approval" }, "Sent to Product approvals — it is read there")}>
            Read as a product approval
          </Button>
        )}
        {i.approvalId && (
          <a className="text-xs text-primary hover:underline" href={`/permits/products/${i.approvalId}`}>
            In Product approvals
          </a>
        )}
      </div>
    </li>
  );
}
