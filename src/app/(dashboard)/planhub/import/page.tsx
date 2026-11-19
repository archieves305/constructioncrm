"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Bookmark, ClipboardPaste, Send } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/bids/pill";
import { useInvalidateBids, useBidOptions } from "@/components/partners/use-partners";
import { fetchJson } from "@/lib/fetch-json";
import { PLANHUB_STAGE_LABEL, type PlanhubPayload } from "@/lib/bids/planhub/parse";
import type { BoardRow } from "@/lib/bids/planhub/plan";
import type { ProjectPlan, ReadResult } from "@/lib/bids/planhub/sync";

const PLANHUB_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*planhub\.com$/i;
const dayLabel = (k: string | null) => (k ? format(new Date(`${k}T12:00:00`), "MMM d, yyyy") : "—");
const selectCls = "h-8 w-full rounded-md border bg-background px-2 text-sm";

/**
 * "Send to CRM": the bookmarklet on a PlanHub page opens this page and hands
 * it what is on the screen (postMessage from a planhub.com origin only), or
 * the person pastes what it copied. Nothing is saved to a bid project until
 * a person ticks rows and applies them.
 */
export default function PlanhubImportPage() {
  const [result, setResult] = useState<ReadResult | null>(null);
  const [reading, setReading] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");

  const read = useCallback(async (payload: PlanhubPayload) => {
    setReading(true);
    try {
      setResult(await fetchJson<ReadResult>("/api/bid-projects/planhub/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setReading(false);
    }
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!PLANHUB_ORIGIN.test(e.origin)) return;
      const d = e.data as { type?: string; url?: string; text?: string; cards?: PlanhubPayload["cards"] } | null;
      if (d?.type !== "planhub-send" || typeof d.url !== "string" || typeof d.text !== "string") return;
      void read({ url: d.url, text: d.text, cards: d.cards ?? null });
    };
    window.addEventListener("message", onMessage);
    // Tell the PlanHub tab this page is ready; the message carries nothing.
    window.opener?.postMessage({ type: "planhub-crm-ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [read]);

  const fromPaste = () => {
    try {
      const d = JSON.parse(pasted) as PlanhubPayload;
      if (typeof d.url !== "string" || typeof d.text !== "string") throw new Error();
      setPasting(false);
      setPasted("");
      void read({ url: d.url, text: d.text, cards: d.cards ?? null });
    } catch {
      toast.error("That is not what Send to CRM copied. Click Send to CRM on PlanHub again and paste here.");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="From PlanHub"
        breadcrumb={[{ label: "PlanHub Bids", href: "/planhub" }, { label: "From PlanHub" }]}
        description="Click Send to CRM on your PlanHub Bid Board or a project's page; what it sends is checked here before anything is saved."
        actions={<Button variant="outline" size="sm" onClick={() => setPasting((x) => !x)}><ClipboardPaste className="mr-1.5 size-4" /> Paste instead</Button>}
      />
      {pasting && (
        <Card>
          <CardContent className="space-y-2 p-3">
            <Textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste what Send to CRM copied" />
            <Button size="sm" variant="brand" onClick={fromPaste} disabled={!pasted.trim()}>Read it</Button>
          </CardContent>
        </Card>
      )}
      {reading && <p className="text-sm text-muted-foreground">Reading the PlanHub page…</p>}
      {!result && !reading && <Setup />}
      {result?.kind === "BOARD" && <BoardReview key={result.snapshotId} snapshotId={result.snapshotId} rows={result.rows} onDone={() => setResult(null)} />}
      {result?.kind === "PROJECT" && <ProjectReview key={result.snapshotId} snapshotId={result.snapshotId} plan={result.plan} onDone={() => setResult(null)} />}
    </div>
  );
}

function Setup() {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // React refuses a javascript: href in JSX; the bookmark's address is set here.
    const src = `${window.location.origin}/planhub-send.js`;
    link.current?.setAttribute("href", `javascript:(function(){var s=document.createElement('script');s.src='${src}?v='+Date.now();document.body.appendChild(s);})();`);
  }, []);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Set up Send to CRM (once)</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>Drag this button to your browser&rsquo;s bookmarks bar:</p>
        <a ref={link} href="#" onClick={(e) => e.preventDefault()} className="inline-flex items-center gap-1.5 rounded-md border bg-brand px-3 py-1.5 font-medium text-brand-foreground">
          <Bookmark className="size-4" /> Send to CRM
        </a>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Sign in to PlanHub as usual. The CRM never sees your PlanHub password.</li>
          <li>On the <b>Bid Board</b>, click <b>Send to CRM</b>: every saved project comes here with its column and due date. Do it again whenever cards move.</li>
          <li>On a <b>project&rsquo;s page</b>, click <b>Send to CRM</b>: its GC, contact, address and trades come here.</li>
          <li>Check what was read, tick what to save, and click Apply.</li>
        </ol>
        <p className="text-xs text-muted-foreground">It reads only the page you have open, only when you click it.</p>
      </CardContent>
    </Card>
  );
}

const ACTION_LABEL = { create: "New", update: "Changed", same: "No change" } as const;
const ACTION_TONE = { create: "info", update: "warning", same: "neutral" } as const;

function BoardReview({ snapshotId, rows, onDone }: { snapshotId: string; rows: BoardRow[]; onDone: () => void }) {
  const invalidate = useInvalidateBids();
  const [picked, setPicked] = useState<Record<number, string>>(() => Object.fromEntries(rows.filter((r) => r.action !== "same" && !r.ambiguous.length).map((r) => [r.index, r.match?.id ?? "new"])));
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    try {
      const out = await fetchJson<{ applied: number; created: number }>("/api/bid-projects/planhub/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "BOARD", snapshotId, rows: Object.entries(picked).map(([index, projectId]) => ({ index: Number(index), projectId })) }) });
      toast.success(`${out.applied} saved${out.created ? ` · ${out.created} new project${out.created === 1 ? "" : "s"}` : ""}`);
      invalidate();
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const count = Object.keys(picked).length;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Bid Board · {rows.length} projects</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onDone}>Cancel</Button>
          <Button variant="brand" size="sm" onClick={apply} disabled={busy || count === 0}><Send className="mr-1.5 size-4" /> Apply {count}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">A column move to Submitted, Won or Lost is shown on the project as a reminder; nothing is marked sent, won or lost without you. The board does not show the GC — click Send to CRM on each project&rsquo;s page for that.</p>
        {rows.map((r) => {
          const on = r.index in picked;
          return (
            <div key={r.index} className="flex flex-wrap items-start gap-3 rounded-md border p-2 text-sm">
              <input type="checkbox" className="mt-1 size-4" aria-label={`Save ${r.card.name}`} checked={on} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[r.index] = r.match?.id ?? r.ambiguous[0]?.id ?? "new"; else delete n[r.index]; return n; })} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.card.name}</span>
                  <Pill tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Pill>
                  {r.card.stage && <Pill tone="neutral">{PLANHUB_STAGE_LABEL[r.card.stage]}</Pill>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Due {dayLabel(r.card.dueOn)}
                  {r.match && <> · <Link className="underline" href={`/planhub/projects/${r.match.id}`}>{r.match.number}</Link></>}
                  {(r.match ? r.changes : []).map((c) => <span key={c.field}> · {c.label}: {c.field === "due" ? `${dayLabel(c.from)} → ${dayLabel(c.to)}` : `${c.from ?? "—"} → ${c.to}`}</span>)}
                </p>
              </div>
              {on && (r.ambiguous.length > 0 || !r.match) && (
                <select className={`${selectCls} sm:w-64`} aria-label="Which project" value={picked[r.index]} onChange={(e) => setPicked((p) => ({ ...p, [r.index]: e.target.value }))}>
                  <option value="new">A new project</option>
                  {r.ambiguous.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ProjectReview({ snapshotId, plan, onDone }: { snapshotId: string; plan: ProjectPlan; onDone: () => void }) {
  const invalidate = useInvalidateBids();
  const router = useRouter();
  const { data: options } = useBidOptions();
  const page = plan.page;
  const base = plan.current;
  const [projectId, setProjectId] = useState<string>(plan.match?.id ?? "new");
  const [form, setForm] = useState({
    name: base?.name ?? page.name ?? "",
    address1: base?.address1 ?? page.address?.address1 ?? "",
    city: base?.city ?? page.address?.city ?? "",
    state: base?.state ?? page.address?.state ?? "FL",
    zipCode: base?.zipCode ?? page.address?.zipCode ?? "",
  });
  const [trades, setTrades] = useState<string[]>(() => [...new Set([...(base?.scopeTradeIds ?? []), ...plan.trades.map((t) => t.serviceCategoryId).filter((x): x is string => Boolean(x))])]);
  // Per GC on the page: the account to use ("" = don't add). A GC PlanHub lists as only prospective starts unticked.
  const [gcChoice, setGcChoice] = useState<string[]>(() => page.gcs.map((g, i) => (/PROSPECTIVE/i.test(g.status ?? "") ? "" : (plan.gcs[i]?.match?.organizationId ?? "new"))));
  const [addContact, setAddContact] = useState(true);
  const [busy, setBusy] = useState(false);
  // Only trades KNU bids (the picker's list) can be scopes; a PlanHub trade that maps elsewhere is dropped.
  const offered = new Set((options?.trades ?? []).map((t) => t.value));
  const chosen = options ? trades.filter((t) => offered.has(t)) : trades;
  const tradeName = (id: string) => options?.trades.find((t) => t.value === id)?.label ?? "Trade";

  const apply = async () => {
    setBusy(true);
    try {
      const out = await fetchJson<{ projectId: string; created: boolean; bids: { number: string; created: boolean }[] }>("/api/bid-projects/planhub/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "PROJECT", snapshotId, projectId, project: { name: form.name, address1: form.address1 || null, city: form.city || null, state: form.state || null, zipCode: form.zipCode || null }, scopeTradeIds: chosen, gcs: gcChoice.flatMap((organizationId, index) => (organizationId ? [{ index, organizationId, addContact }] : [])) }),
      });
      const added = out.bids.filter((b) => b.created).length;
      toast.success(`${out.created ? "Project created" : "Project updated"}${added ? ` · ${added} GC${added === 1 ? "" : "s"} added` : ""}`);
      invalidate();
      router.push(`/planhub/projects/${out.projectId}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="min-w-0">
        <CardHeader><CardTitle className="text-base">Project</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Save to</span>
            <select className={selectCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="new">A new project</option>
              {plan.candidates.map((c) => <option key={c.id} value={c.id}>{c.number} · {c.name} (same {c.how})</option>)}
            </select>
          </label>
          {projectId !== "new" && <p className="text-xs text-muted-foreground">Only the project&rsquo;s empty fields are filled; what you typed in the CRM stays.</p>}
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Street"><Input value={form.address1} onChange={(e) => setForm({ ...form, address1: e.target.value })} /></Field>
          <div className="grid grid-cols-[1fr_4rem_6rem] gap-2">
            <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="State"><Input value={form.state} maxLength={2} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} /></Field>
            <Field label="Zip"><Input value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} /></Field>
          </div>
          <p className="text-xs text-muted-foreground">
            PlanHub #{page.platformRef} · due to the GC {page.bidDueAt ? format(new Date(page.bidDueAt), page.bidDueHasTime ? "MMM d, yyyy h:mm a" : "MMM d, yyyy") : "—"}
            {page.projectValue != null && <> · project value ${page.projectValue.toLocaleString()}</>}
            {page.projectType && <> · {page.projectType}</>}
            {page.prevailingWage && <> · prevailing wage</>}
          </p>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader><CardTitle className="text-base">GC and scopes</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {page.gcs.length === 0 && <p className="text-muted-foreground">The page showed no GC.</p>}
          {page.gcs.map((g, i) => {
            const row = plan.gcs[i];
            return (
              <div key={i} className="space-y-1 rounded-md border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  {g.status && <Pill tone={/BIDDING/i.test(g.status) ? "info" : "neutral"}>{g.status.charAt(0) + g.status.slice(1).toLowerCase()}</Pill>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[g.contactName, g.contactEmail, g.contactPhone].filter(Boolean).join(" · ") || "No contact shown"}
                  {g.bidDueAt && <> · due {format(new Date(g.bidDueAt), g.bidDueHasTime ? "MMM d, h:mm a" : "MMM d")}</>}
                </p>
                <select className={selectCls} aria-label={`Account for ${g.name}`} value={gcChoice[i]} onChange={(e) => setGcChoice((c) => c.map((x, k) => (k === i ? e.target.value : x)))}>
                  {row?.match && <option value={row.match.organizationId}>{row.match.name} (matched by {row.match.how})</option>}
                  <option value="new">Create the account &ldquo;{g.name}&rdquo;</option>
                  <option value="">Don&rsquo;t add this GC</option>
                </select>
                {row?.onProject && <p className="text-xs text-muted-foreground">Already on this project as {row.onProject.number}.</p>}
              </div>
            );
          })}
          {page.gcs.some((g, i) => g.contactName && gcChoice[i]) && (
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="size-4" checked={addContact} onChange={(e) => setAddContact(e.target.checked)} /> Add the named contacts if they are not there yet</label>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Scopes KNU is pricing</p>
            <div className="flex flex-wrap gap-1.5">
              {(options?.trades ?? []).map((t) => {
                const on = trades.includes(t.value);
                return (
                  <button key={t.value} type="button" onClick={() => setTrades((x) => (on ? x.filter((y) => y !== t.value) : [...x, t.value]))} className={`h-7 rounded-full border px-2.5 text-xs ${on ? "border-brand bg-brand/10 font-medium" : "text-muted-foreground"}`} aria-pressed={on}>{t.label}</button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">PlanHub lists: {page.trades.join(", ") || "—"}{page.moreTrades ? ` (${page.moreTrades} in all)` : ""}. Ticked: {chosen.map(tradeName).join(", ") || "none"}.</p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onDone}>Cancel</Button>
            <Button variant="brand" size="sm" onClick={apply} disabled={busy || !form.name.trim()}><Send className="mr-1.5 size-4" /> Apply</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
