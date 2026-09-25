"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Eye, FilePlus2, Plus, Rocket, Save, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SortableList } from "@/components/ui/sortable-list";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Callout } from "@/components/shared/callout";
import { useSession } from "@/lib/auth/session-client";
import { validatePaymentSchedule } from "@/lib/customer-contracts/schedule";
import { validateTemplateContent } from "@/lib/customer-contracts/template-content";
import type { ContractArticle, ContractTemplateContent, PaymentScheduleItem } from "@/lib/customer-contracts/types";
import {
  openTemplatePreview,
  useArchiveVersion,
  useContractTemplate,
  useCreateDraftVersion,
  useMergeFields,
  usePublishVersion,
  useSaveDraftVersion,
  useUpdateContractTemplate,
  type TemplateVersionDetail,
} from "../use-contract-templates";

type ArticleRow = ContractArticle & { id: string };

function withoutId<T extends { id: string }>(row: T): Omit<T, "id"> {
  const { id, ...rest } = row;
  void id;
  return rest;
}

let uidCounter = 0;
const uid = () => `r${++uidCounter}_${Math.random().toString(36).slice(2, 7)}`;

function toForm(v: TemplateVersionDetail) {
  return {
    title: v.title,
    articles: v.articles.map((a) => ({ ...a, id: uid() })),
    stages: v.paymentSchedule.items.map((i) => ({ ...i, id: uid() })),
    paymentScheduleText: v.paymentScheduleText,
    consentText: v.consentText,
  };
}
type Form = ReturnType<typeof toForm>;

function toContent(f: Form): ContractTemplateContent {
  return {
    title: f.title,
    articles: f.articles.map((a) => withoutId(a)),
    paymentSchedule: { items: f.stages.map((s) => ({ ...withoutId(s), percent: Number(s.percent) })) },
    paymentScheduleText: f.paymentScheduleText,
    consentText: f.consentText,
  };
}

const slugKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9]/, "a$&");

export function ContractTemplateEditor({ templateId, versionId }: { templateId: string; versionId: string | null }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "ADMIN";
  const { data: template, isLoading, error } = useContractTemplate(templateId);
  const update = useUpdateContractTemplate(templateId);
  const createDraft = useCreateDraftVersion(templateId);
  const archive = useArchiveVersion(templateId);

  const versions = template?.versions ?? [];
  const selected = versions.find((v) => v.id === versionId) ?? versions.find((v) => v.status === "DRAFT") ?? versions.find((v) => v.status === "PUBLISHED") ?? versions[0] ?? null;
  const published = versions.find((v) => v.status === "PUBLISHED");

  if (error) return <Callout tone="danger" title="Couldn't load the template">{error instanceof Error ? error.message : "Something went wrong."}</Callout>;
  if (isLoading || !template) return <Skeleton className="h-96" />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 sm:items-center">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <Link href="/admin/contract-templates" className="text-muted-foreground hover:text-foreground" aria-label="Back to templates">
              <ArrowLeft className="size-5" />
            </Link>
            {template.name}
            {template.isDefault && (
              <Badge className="bg-tone-success-soft text-tone-success-fg">
                <Star className="mr-1 size-3" /> Default
              </Badge>
            )}
          </h1>
          <div className="text-sm text-muted-foreground">
            <span className="font-mono text-xs">{template.key}</span>
            {template.description ? ` · ${template.description}` : ""}
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {!template.isDefault && published && (
              <Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ isDefault: true })}>
                Set as default
              </Button>
            )}
            {!versions.some((v) => v.status === "DRAFT") && (
              <Button variant="brand" disabled={createDraft.isPending} onClick={() => createDraft.mutate({}, { onSuccess: (v) => router.replace(`/admin/contract-templates/${templateId}?v=${v.id}`) })}>
                <FilePlus2 className="size-4" /> New draft{published ? ` from v${published.version}` : ""}
              </Button>
            )}
          </div>
        )}
      </div>

      {versions.length > 1 && (
        <div className="mb-4">
          <SegmentedControl
            ariaLabel="Version"
            value={selected?.id ?? ""}
            onValueChange={(v) => router.replace(`/admin/contract-templates/${templateId}?v=${v}`)}
            options={versions.map((v) => ({ value: v.id, label: `v${v.version} · ${v.status.toLowerCase()}` }))}
          />
        </div>
      )}

      {!selected ? (
        <Callout tone="info" title="No versions yet">Create a draft to start writing the agreement.</Callout>
      ) : (
        <VersionEditor key={selected.id} templateId={templateId} version={selected} isAdmin={isAdmin} onArchive={() => archive.mutate(selected.id)} />
      )}
    </div>
  );
}

function VersionEditor({ templateId, version, isAdmin, onArchive }: { templateId: string; version: TemplateVersionDetail; isAdmin: boolean; onArchive: () => void }) {
  const editable = isAdmin && version.status === "DRAFT";
  const [form, setForm] = useState<Form>(() => toForm(version));
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const save = useSaveDraftVersion(templateId);
  const publish = usePublishVersion(templateId);
  const { data: mergeFields = [] } = useMergeFields();
  const focusedBody = useRef<{ index: number; el: HTMLTextAreaElement } | null>(null);

  const problems = validateTemplateContent(toContent(form));
  const scheduleErrors = validatePaymentSchedule(toContent(form).paymentSchedule.items);
  const percentSum = form.stages.reduce((s, x) => s + (Number(x.percent) || 0), 0);

  function patch(p: Partial<Form>) {
    setForm((f) => ({ ...f, ...p }));
    setDirty(true);
  }
  function patchArticle(id: string, p: Partial<ContractArticle>) {
    patch({ articles: form.articles.map((a) => (a.id === id ? { ...a, ...p } : a)) });
  }
  function patchStage(id: string, p: Partial<PaymentScheduleItem>) {
    patch({ stages: form.stages.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  }
  function insertField(key: string) {
    const f = focusedBody.current;
    if (!f) {
      toast.info("Click into an article body first, then pick a field to insert");
      return;
    }
    const el = f.el;
    const a = form.articles[f.index];
    const start = el.selectionStart ?? a.body.length;
    const end = el.selectionEnd ?? start;
    const body = `${a.body.slice(0, start)}{{${key}}}${a.body.slice(end)}`;
    patchArticle(a.id, { body });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + key.length + 4;
      el.setSelectionRange(pos, pos);
    });
  }

  async function doSave(): Promise<boolean> {
    try {
      await save.mutateAsync({ versionId: version.id, content: toContent(form) });
      setDirty(false);
      toast.success("Draft saved");
      return true;
    } catch {
      return false;
    }
  }

  async function doPreview() {
    setPreviewing(true);
    try {
      await openTemplatePreview(version.id, editable ? toContent(form) : null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">v{version.version}</Badge>
          <Badge className={version.status === "PUBLISHED" ? "bg-tone-success-soft text-tone-success-fg" : version.status === "DRAFT" ? "bg-tone-info-soft text-tone-info-fg" : ""} variant={version.status === "PUBLISHED" || version.status === "DRAFT" ? undefined : "outline"}>
            {version.status.toLowerCase()}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {version.status === "PUBLISHED" && version.publishedAt ? `Published ${new Date(version.publishedAt).toLocaleDateString()}${version.publishedBy ? ` by ${version.publishedBy.firstName} ${version.publishedBy.lastName}` : ""} · ` : ""}
            used by {version._count.contracts} contract{version._count.contracts === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={previewing} onClick={doPreview}>
            <Eye className="size-4" /> Preview PDF
          </Button>
          {editable && (
            <>
              <Button variant="outline" size="sm" disabled={!dirty || save.isPending} onClick={doSave}>
                <Save className="size-4" /> {dirty ? "Save draft" : "Saved"}
              </Button>
              <Button variant="brand" size="sm" disabled={save.isPending} onClick={() => setPublishing(true)}>
                <Rocket className="size-4" /> Publish…
              </Button>
            </>
          )}
          {isAdmin && version.status !== "ARCHIVED" && version.status !== "PUBLISHED" && (
            <Button variant="ghost" size="sm" onClick={onArchive}>
              Archive
            </Button>
          )}
        </div>
      </div>

      {version.status === "PUBLISHED" && (
        <Callout tone="info">
          v{version.version} is published{version._count.contracts > 0 ? ` and pinned by ${version._count.contracts} contract${version._count.contracts === 1 ? "" : "s"}` : ""}. It cannot be edited — create a draft to change the wording; contracts already generated keep this version.
        </Callout>
      )}
      {editable && problems.length > 0 && (
        <Callout tone="warning" title="Before this can be published">
          <ul className="list-disc pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Callout>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Agreement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={form.title} disabled={!editable} onChange={(e) => patch({ title: e.target.value })} />
          </div>
          <p className="text-xs text-muted-foreground">
            Articles 1–3 (Scope of Work, Contract Price, Payment Schedule) are generated from the estimate. Your articles follow as 4 onward. A blank line starts a new paragraph; a line beginning with &ldquo;- &rdquo; is a bullet.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">Articles ({form.articles.length})</CardTitle>
          {editable && (
            <Button size="sm" variant="outline" onClick={() => patch({ articles: [...form.articles, { id: uid(), key: "", title: "", body: "" }] })}>
              <Plus className="size-4" /> Add article
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {editable && mergeFields.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-2">
              <p className="mb-1 text-xs text-muted-foreground">Insert a merge field at the cursor:</p>
              <div className="flex flex-wrap gap-1">
                {mergeFields.map((f) => (
                  <button key={f.key} type="button" title={f.description} className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent" onClick={() => insertField(f.key)}>
                    {`{{${f.key}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {form.articles.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No articles yet.</p>
          ) : (
            <SortableList<ArticleRow>
              items={form.articles}
              label="Articles"
              disabled={!editable}
              onReorder={(ids) => patch({ articles: ids.map((id) => form.articles.find((a) => a.id === id)!) })}
              renderItem={(a, index) => (
                <div className="flex-1 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                    <div>
                      <Label className="text-xs">Article {index + 4} title</Label>
                      <Input
                        value={a.title}
                        disabled={!editable}
                        onChange={(e) => patchArticle(a.id, { title: e.target.value, ...(a.key === "" || a.key === slugKey(a.title) ? { key: slugKey(e.target.value) } : {}) })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Key</Label>
                      <Input value={a.key} disabled={!editable} className="font-mono text-xs" onChange={(e) => patchArticle(a.id, { key: slugKey(e.target.value) })} />
                    </div>
                    {editable && (
                      <div className="flex items-end">
                        <Button size="icon" variant="ghost" aria-label="Remove article" onClick={() => patch({ articles: form.articles.filter((x) => x.id !== a.id) })}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <Textarea
                    rows={6}
                    value={a.body}
                    disabled={!editable}
                    onFocus={(e) => (focusedBody.current = { index, el: e.currentTarget })}
                    onChange={(e) => patchArticle(a.id, { body: e.target.value })}
                  />
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">Payment schedule</CardTitle>
          <span className={`text-xs ${Math.abs(percentSum - 100) < 0.005 ? "text-tone-success-fg" : "text-tone-danger-fg"}`}>Sum: {Math.round(percentSum * 100) / 100}%</span>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Wording above the table</Label>
            <Input value={form.paymentScheduleText} disabled={!editable} onChange={(e) => patch({ paymentScheduleText: e.target.value })} />
          </div>
          <div className="space-y-2">
            {form.stages.map((s, i) => (
              <div key={s.id} className="grid gap-2 sm:grid-cols-[120px_1fr_90px_2fr_auto]">
                <div>
                  {i === 0 && <Label className="text-xs">Key</Label>}
                  <Input value={s.key} disabled={!editable} className="font-mono text-xs" onChange={(e) => patchStage(s.id, { key: slugKey(e.target.value) })} />
                </div>
                <div>
                  {i === 0 && <Label className="text-xs">Label</Label>}
                  <Input value={s.label} disabled={!editable} onChange={(e) => patchStage(s.id, { label: e.target.value })} />
                </div>
                <div>
                  {i === 0 && <Label className="text-xs">%</Label>}
                  <Input type="number" min={0} max={100} step="0.01" value={s.percent} disabled={!editable} onChange={(e) => patchStage(s.id, { percent: Number(e.target.value) })} />
                </div>
                <div>
                  {i === 0 && <Label className="text-xs">Due when</Label>}
                  <Input value={s.trigger} disabled={!editable} onChange={(e) => patchStage(s.id, { trigger: e.target.value })} />
                </div>
                <div className={i === 0 ? "flex items-end" : ""}>
                  {editable && (
                    <Button size="icon" variant="ghost" aria-label="Remove stage" onClick={() => patch({ stages: form.stages.filter((x) => x.id !== s.id) })}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {editable && (
            <Button size="sm" variant="outline" onClick={() => patch({ stages: [...form.stages, { id: uid(), key: "", label: "", percent: 0, trigger: "" }] })}>
              <Plus className="size-4" /> Add stage
            </Button>
          )}
          {scheduleErrors.length > 0 && <p className="text-xs text-tone-danger-fg">{scheduleErrors.join(" · ")}</p>}
          <p className="text-xs text-muted-foreground">The first stage is the deposit. Each stage&rsquo;s amount is available to articles as {"{{schedule.<key>.amount}}"}.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">E-signature consent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Textarea rows={4} value={form.consentText} disabled={!editable} onChange={(e) => patch({ consentText: e.target.value })} />
          <p className="text-xs text-muted-foreground">Shown next to the checkbox the customer must tick before signing, and printed on the signature certificate.</p>
        </CardContent>
      </Card>

      <PublishDialog
        open={publishing}
        onOpenChange={setPublishing}
        version={version}
        problems={problems}
        pending={publish.isPending || save.isPending}
        onPublish={async (notes) => {
          if (dirty && !(await doSave())) return;
          publish.mutate({ versionId: version.id, changeNotes: notes }, { onSuccess: () => setPublishing(false) });
        }}
      />
    </div>
  );
}

function PublishDialog({ open, onOpenChange, version, problems, pending, onPublish }: { open: boolean; onOpenChange: (o: boolean) => void; version: TemplateVersionDetail; problems: string[]; pending: boolean; onPublish: (notes: string | null) => void }) {
  const [notes, setNotes] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Publish v{version.version}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Publishing freezes v{version.version}. New contracts use it from now on; contracts already generated keep the version they were built from.</p>
          {problems.length > 0 ? (
            <Callout tone="danger" title="Fix these first">
              <ul className="list-disc pl-4">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Callout>
          ) : (
            <div>
              <Label className="text-xs">What changed (optional)</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="brand" disabled={problems.length > 0 || pending} onClick={() => onPublish(notes.trim() || null)}>
              <Rocket className="mr-1 size-4" /> Publish
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
