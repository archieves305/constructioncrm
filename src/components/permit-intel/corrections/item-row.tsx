"use client";

import { useRef, useState } from "react";
import { format } from "date-fns";
import Link from "next/link";
import { CornerDownRight, Paperclip, Pencil, Repeat2, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";
import { uploadProblem } from "@/lib/files/limits";
import {
  CATEGORY_LABEL,
  CORRECTION_CATEGORIES,
  CORRECTION_TARGETS,
  PARTY_LABEL,
  RESPONSIBLE_PARTIES,
  STATUS_LABEL,
  TARGET_LABEL,
  type CorrectionStatus,
} from "@/lib/permit-intel/corrections-plan";
import { toneClasses, type Tone } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import type { PermitFile, PermitParty } from "../types";
import type { CorrectionItem } from "./types";
import { useCorrectionsWrite, useInvalidateCorrections } from "./use-corrections";

const STATUS_TONE: Record<CorrectionStatus, Tone> = { PROPOSED: "info", OPEN: "warning", WAITING_THIRD_PARTY: "info", RESOLVED: "success", DISPUTED: "danger", WAIVED: "neutral" };
const WORK_STATUSES = (["OPEN", "WAITING_THIRD_PARTY", "RESOLVED", "DISPUTED", "WAIVED"] as const).map((v) => ({ value: v, label: STATUS_LABEL[v] }));
const CATEGORY_ITEMS = CORRECTION_CATEGORIES.map((v) => ({ value: v, label: CATEGORY_LABEL[v] }));
const TARGET_ITEMS = CORRECTION_TARGETS.map((v) => ({ value: v, label: TARGET_LABEL[v] }));
const PARTY_ITEMS = RESPONSIBLE_PARTIES.map((v) => ({ value: v, label: PARTY_LABEL[v] }));

function Pill({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(tone).pill)}>
      {children}
    </span>
  );
}

export function itemNumber(i: { reviewerItemNumber: string | null; sortOrder: number }) {
  return i.reviewerItemNumber ?? `#${i.sortOrder + 1}`;
}

/**
 * One correction. Before the notice is confirmed it is a proposal to check
 * (the model's confidence shown, every field editable, noise deleted); after,
 * it is work: a status, the line for the response letter, the revised files
 * that answer it and its task.
 */
export function ItemRow({
  item,
  permitId,
  confirmed,
  canEdit,
  parties,
  files,
  selected,
  onSelect,
}: {
  item: CorrectionItem;
  permitId: string;
  confirmed: boolean;
  canEdit: boolean;
  parties: PermitParty[];
  files: PermitFile[];
  selected?: boolean;
  onSelect?: (on: boolean) => void;
}) {
  const write = useCorrectionsWrite(permitId);
  const invalidate = useInvalidateCorrections(permitId);
  const [editing, setEditing] = useState(false);
  const [response, setResponse] = useState(item.response ?? "");
  const upload = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const lowConfidence = item.confidence != null && item.confidence < 0.7;
  const linked = new Set(item.files.map((f) => f.file.id));
  const linkable = files.filter((f) => !linked.has(f.id) && f.permitDocType !== "correction_notice").map((f) => ({ value: f.id, label: f.fileName }));

  const patch = (body: Record<string, unknown>) => write.mutate({ url: `/api/correction-items/${item.id}`, method: "PATCH", body });
  const saveResponse = () => {
    if ((item.response ?? "") === response.trim()) return;
    patch({ response: response.trim() || null });
  };
  const link = (fileId: string) => write.mutate({ url: `/api/correction-items/${item.id}/files`, method: "POST", body: { fileId } });

  const uploadRevised = async (list: FileList | null) => {
    const f = list?.[0];
    if (upload.current) upload.current.value = "";
    if (!f) return;
    const problem = uploadProblem(f);
    if (problem) return void toast.error(problem);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("permitId", permitId);
      form.append("permitDocType", item.affects === "PLAN_SHEET" ? "revised_plans" : item.affects === "PRODUCT_APPROVAL" ? "product_approval" : "other");
      const created = await fetchJson<{ id: string }>("/api/files", { method: "POST", body: form });
      await fetchJson(`/api/correction-items/${item.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: created.id }) });
      toast.success(`${f.name} linked to comment ${itemNumber(item)}`);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex items-start gap-2">
        {onSelect && <Checkbox className="mt-0.5" checked={!!selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={`Pick comment ${itemNumber(item)}`} />}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{itemNumber(item)}</span>
            {item.reviewerDiscipline && <span className="text-xs text-muted-foreground">{item.reviewerDiscipline}</span>}
            {confirmed && <Pill tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Pill>}
            {lowConfidence && !confirmed && (
              <Pill tone="warning" title="The AI was unsure about this one">
                Check this · {Math.round((item.confidence ?? 0) * 100)}%
              </Pill>
            )}
            {item.previousItem && (
              <Pill tone="danger" title="The department made this comment on the previous review too">
                <Repeat2 className="size-3" /> Repeats {itemNumber(item.previousItem)}
              </Pill>
            )}
            {item.reviewOutcome && <Pill tone={item.reviewOutcome === "ACCEPTED" ? "success" : "danger"}>{item.reviewOutcome === "ACCEPTED" ? "Accepted on re-review" : "Commented again"}</Pill>}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-snug">{item.text}</p>
          <p className="text-[11px] text-muted-foreground">
            {CATEGORY_LABEL[item.category]} · {item.affectsRef ?? TARGET_LABEL[item.affects]} · {item.party?.name ?? PARTY_LABEL[item.responsibleParty]}
            {item.sourcePage ? ` · page ${item.sourcePage}` : ""}
            {item.dueAt ? ` · due ${format(new Date(item.dueAt), "MMM d")}` : ""}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Edit the item" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" />
            </Button>
            {!confirmed && (
              <Button size="icon-sm" variant="ghost" aria-label="Delete the item" onClick={() => write.mutate({ url: `/api/correction-items/${item.id}`, method: "DELETE" })}>
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {confirmed && (
        <div className="ml-0 space-y-2 border-l-2 border-muted pl-3 sm:ml-6">
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Select items={WORK_STATUSES} value={item.status} onValueChange={(v: string | null) => v && v !== item.status && patch({ status: v })}>
                <SelectTrigger className="h-8 w-[190px] text-xs" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {item.task && (
              <Link href={`/tasks?task=${item.task.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <CornerDownRight className="size-3" /> Task {item.task.status === "COMPLETED" ? "done" : item.task.status === "CANCELLED" ? "closed" : "open"}
              </Link>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`resp-${item.id}`} className="text-xs">
              Response for the letter
            </Label>
            <Textarea
              id={`resp-${item.id}`}
              rows={2}
              value={response}
              disabled={!canEdit}
              onChange={(e) => setResponse(e.target.value)}
              onBlur={saveResponse}
              placeholder="e.g. Sheet A-2.1 revised to show the shutters; see the revised set."
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.files.map(({ file }) => (
              <span key={file.id} className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
                <Paperclip className="size-3 shrink-0" />
                <span className="truncate">{file.fileName}</span>
                {canEdit && (
                  <button type="button" aria-label={`Unlink ${file.fileName}`} onClick={() => write.mutate({ url: `/api/correction-items/${item.id}/files?fileId=${file.id}`, method: "DELETE" })}>
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
            {canEdit && (
              <>
                {linkable.length > 0 && (
                  <Select items={linkable} value={null} onValueChange={(v: string | null) => v && link(v)}>
                    <SelectTrigger className="h-7 w-[180px] text-[11px]" aria-label="Link a revised file">
                      <SelectValue placeholder="Link a revised file" />
                    </SelectTrigger>
                    <SelectContent>
                      {linkable.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <input ref={upload} type="file" className="hidden" onChange={(e) => uploadRevised(e.target.files)} />
                <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={uploading} onClick={() => upload.current?.click()}>
                  <Upload className="size-3" /> {uploading ? "Uploading…" : "Upload a revised file"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">{editing && <ItemForm permitId={permitId} item={item} parties={parties} onClose={() => setEditing(false)} />}</DialogContent>
      </Dialog>
    </li>
  );
}

/** Add an item the reading missed (no `item`), or edit one. */
export function ItemForm({ permitId, noticeId, item, parties, onClose }: { permitId: string; noticeId?: string; item?: CorrectionItem; parties: PermitParty[]; onClose: () => void }) {
  const write = useCorrectionsWrite(permitId);
  const [f, setF] = useState({
    reviewerItemNumber: item?.reviewerItemNumber ?? "",
    reviewerDiscipline: item?.reviewerDiscipline ?? "",
    text: item?.text ?? "",
    sourcePage: item?.sourcePage ? String(item.sourcePage) : "",
    category: item?.category ?? "OTHER",
    affects: item?.affects ?? "OTHER",
    affectsRef: item?.affectsRef ?? "",
    responsibleParty: item?.responsibleParty ?? "KNU",
    partyId: item?.partyId ?? "",
    dueOn: item?.dueAt ? format(new Date(item.dueAt), "yyyy-MM-dd") : "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const partyItems = [{ value: "", label: "Not one of the permit's parties" }, ...parties.map((p) => ({ value: p.id, label: p.name }))];

  const save = () => {
    const body = {
      reviewerItemNumber: f.reviewerItemNumber || null,
      reviewerDiscipline: f.reviewerDiscipline || null,
      text: f.text,
      sourcePage: f.sourcePage ? Number(f.sourcePage) : null,
      category: f.category,
      affects: f.affects,
      affectsRef: f.affectsRef || null,
      responsibleParty: f.responsibleParty,
      partyId: f.partyId || null,
      dueAt: f.dueOn ? `${f.dueOn}T12:00:00.000Z` : null,
    };
    write.mutate(item ? { url: `/api/correction-items/${item.id}`, method: "PATCH", body } : { url: `/api/correction-notices/${noticeId}/items`, method: "POST", body }, { onSuccess: onClose });
  };

  const sel = (id: string, label: string, value: string, items: { value: string; label: string }[], on: (v: string) => void) => (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select items={items} value={value} onValueChange={(v: string | null) => v !== null && on(v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value || "none"} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? `Comment ${itemNumber(item)}` : "Add a correction"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="it-num">Department&apos;s number</Label>
            <Input id="it-num" value={f.reviewerItemNumber} onChange={(e) => set("reviewerItemNumber")(e.target.value)} placeholder="B-3" />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="it-disc">Discipline</Label>
            <Input id="it-disc" value={f.reviewerDiscipline} onChange={(e) => set("reviewerDiscipline")(e.target.value)} placeholder="Building" />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="it-page">Page</Label>
            <Input id="it-page" inputMode="numeric" value={f.sourcePage} onChange={(e) => set("sourcePage")(e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="it-text">The comment, as written</Label>
          <Textarea id="it-text" rows={4} value={f.text} onChange={(e) => set("text")(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {sel("it-cat", "Category", f.category, CATEGORY_ITEMS, set("category"))}
          {sel("it-aff", "It concerns", f.affects, TARGET_ITEMS, set("affects"))}
          <div className="min-w-0 space-y-1">
            <Label htmlFor="it-ref">Sheet, form or approval</Label>
            <Input id="it-ref" value={f.affectsRef} onChange={(e) => set("affectsRef")(e.target.value)} placeholder="A-2.1" />
          </div>
          {sel("it-who", "Who must act", f.responsibleParty, PARTY_ITEMS, set("responsibleParty"))}
          {sel("it-party", "Party", f.partyId, partyItems, set("partyId"))}
          <div className="min-w-0 space-y-1">
            <Label htmlFor="it-due">Due</Label>
            <Input id="it-due" type="date" value={f.dueOn} onChange={(e) => set("dueOn")(e.target.value)} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="brand" disabled={!f.text.trim() || write.isPending} onClick={save}>
          {write.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
