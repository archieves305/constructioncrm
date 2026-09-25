"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ListChecks, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { EntityTaskPanel } from "@/components/tasks/entity-task-panel";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { FilesPanel } from "@/components/files/files-panel";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { ITEM_STATUSES, ITEM_STATUS_LABEL, ITEM_STATUS_TONE } from "./status";
import { money, useCaseAction, useViolationCategories, violationKeys, type CaseData } from "./use-violations";

type Item = CaseData["items"][number];

const PERMIT_OPTIONS = [
  { value: "UNDETERMINED", label: "Undetermined" },
  { value: "REQUIRED", label: "Permit required" },
  { value: "NOT_REQUIRED", label: "No permit" },
];

/** The cited violations: one row each, inline status, a sheet with tasks and files per item. */
export function ItemsPanel({ data, openItemId, onOpenItem }: { data: CaseData; openItemId: string | null; onOpenItem: (id: string | null) => void }) {
  const { data: users = [] } = useAssignableUsers();
  const [adding, setAdding] = useState(false);
  const canEdit = data.permissions.canEdit && data.status !== "CLOSED" && data.status !== "CANCELLED";
  const open = data.items.find((i) => i.id === openItemId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data.items.length} item{data.items.length === 1 ? "" : "s"} · {data.items.filter((i) => i.status === "VERIFIED" || i.status === "WITHDRAWN").length} closed
        </p>
        {canEdit && (
          <Button size="sm" variant="brand" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add item
          </Button>
        )}
      </div>
      {data.items.length === 0 ? (
        <EmptyState icon={ListChecks} title="No violation items yet" description="Create one item for every violation cited on the notice." />
      ) : (
        <div className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Est.</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Tasks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((it) => (
                <ItemRow key={it.id} item={it} caseId={data.id} canEdit={canEdit} users={users} onOpen={() => onOpenItem(it.id)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ItemDialog open={adding} onOpenChange={setAdding} caseId={data.id} />
      <ItemSheet item={open} data={data} canEdit={canEdit} onClose={() => onOpenItem(null)} />
    </div>
  );
}

function ItemRow({ item, caseId, canEdit, users, onOpen }: { item: Item; caseId: string; canEdit: boolean; users: { id: string; firstName: string; lastName: string; isActive: boolean }[]; onOpen: () => void }) {
  const patch = useCaseAction<Record<string, unknown>>(caseId, `/items/${item.id}`, { method: "PATCH" });
  return (
    <TableRow className="cursor-pointer hover:bg-gray-50" onClick={onOpen}>
      <TableCell className="font-mono text-xs">{item.itemNumber}</TableCell>
      <TableCell className="text-xs">{item.category?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="max-w-[320px]">
        <div className="truncate text-sm">{item.description}</div>
        {item.codeSection && <div className="text-[11px] text-muted-foreground">§ {item.codeSection}</div>}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <Select value={item.status} onValueChange={(v: string | null) => v && v !== item.status && patch.mutate({ status: v })}>
            <SelectTrigger className="h-7 w-[130px] text-xs">
              <SelectValue>{(v: string) => <span className={toneClasses(ITEM_STATUS_TONE[v] ?? "neutral").text}>{ITEM_STATUS_LABEL[v] ?? v}</span>}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ITEM_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ITEM_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge className={cn("border-0 text-[11px]", toneClasses(ITEM_STATUS_TONE[item.status] ?? "neutral").pill)}>{ITEM_STATUS_LABEL[item.status]}</Badge>
        )}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <AssigneePicker size="sm" className="w-[150px]" value={item.assignedUserId} users={users} onChange={(id) => patch.mutate({ assignedUserId: id })} />
        ) : (
          <UserAvatar user={item.assignedTo} size="xs" />
        )}
      </TableCell>
      <TableCell className="text-xs">{item.targetCompletionAt ? format(new Date(item.targetCompletionAt), "MMM d") : "—"}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">{money(item.estimatedCost)}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">{money(item.actualCost)}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">{item._count.tasks}</TableCell>
    </TableRow>
  );
}

type ItemForm = { categoryId: string; codeSection: string; description: string; correctiveAction: string; responsibleTrade: string; permitRequirement: string; contractorName: string; targetCompletionAt: string; estimatedCost: string; actualCost: string };

function formFrom(item: Item | null): ItemForm {
  return {
    categoryId: item?.category?.id ?? "",
    codeSection: item?.codeSection ?? "",
    description: item?.description ?? "",
    correctiveAction: item?.correctiveAction ?? "",
    responsibleTrade: item?.responsibleTrade ?? "",
    permitRequirement: item?.permitRequirement ?? "UNDETERMINED",
    contractorName: item?.contractorName ?? "",
    targetCompletionAt: item?.targetCompletionAt ? item.targetCompletionAt.slice(0, 10) : "",
    estimatedCost: item?.estimatedCost ?? "",
    actualCost: item?.actualCost ?? "",
  };
}

/** Add or edit an item. */
export function ItemDialog({ open, onOpenChange, caseId, item }: { open: boolean; onOpenChange: (o: boolean) => void; caseId: string; item?: Item | null }) {
  const { data: categories = [] } = useViolationCategories();
  const [form, setForm] = useState<ItemForm>(() => formFrom(item ?? null));
  const create = useCaseAction<Record<string, unknown>>(caseId, "/items", { success: "Item added" });
  const patch = useCaseAction<Record<string, unknown>>(caseId, `/items/${item?.id ?? ""}`, { method: "PATCH", success: "Item saved" });
  const pending = create.isPending || patch.isPending;
  const set = <K extends keyof ItemForm>(k: K, v: ItemForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const reset = (o: boolean) => {
    if (o) setForm(formFrom(item ?? null));
    onOpenChange(o);
  };
  const submit = () => {
    const body = {
      categoryId: form.categoryId || null,
      codeSection: form.codeSection.trim() || null,
      description: form.description.trim(),
      correctiveAction: form.correctiveAction.trim() || null,
      responsibleTrade: form.responsibleTrade.trim() || null,
      permitRequirement: form.permitRequirement,
      contractorName: form.contractorName.trim() || null,
      targetCompletionAt: form.targetCompletionAt || null,
      estimatedCost: form.estimatedCost.trim() || null,
      ...(item ? { actualCost: form.actualCost.trim() || null } : {}),
    };
    (item ? patch : create).mutate(body, { onSuccess: () => onOpenChange(false) });
  };
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? `Item ${item.itemNumber}` : "Add a violation item"}</DialogTitle>
          <DialogDescription>One item per violation cited on the notice.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={form.categoryId || "__none"} onValueChange={(v: string | null) => set("categoryId", !v || v === "__none" ? "" : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => (!v || v === "__none" ? "Pick a category" : (categories.find((c) => c.id === v)?.name ?? "—"))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Code section</Label>
            <Input className="mt-1" value={form.codeSection} onChange={(e) => set("codeSection", e.target.value)} placeholder="e.g. Sec. 8-5(b)" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Description (as cited)</Label>
            <Textarea className="mt-1" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Required corrective action</Label>
            <Textarea className="mt-1" rows={2} value={form.correctiveAction} onChange={(e) => set("correctiveAction", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Responsible trade</Label>
            <Input className="mt-1" value={form.responsibleTrade} onChange={(e) => set("responsibleTrade", e.target.value)} placeholder="Roofing, Electrical…" />
          </div>
          <div>
            <Label className="text-xs">Permit requirement</Label>
            <Select value={form.permitRequirement} onValueChange={(v: string | null) => v && set("permitRequirement", v)}>
              <SelectTrigger className="mt-1">
                <SelectValue>{(v: string) => PERMIT_OPTIONS.find((o) => o.value === v)?.label ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PERMIT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Contractor (if external)</Label>
            <Input className="mt-1" value={form.contractorName} onChange={(e) => set("contractorName", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Target completion</Label>
            <Input type="date" className="mt-1" value={form.targetCompletionAt} onChange={(e) => set("targetCompletionAt", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Estimated cost</Label>
            <Input className="mt-1" inputMode="decimal" value={form.estimatedCost} onChange={(e) => set("estimatedCost", e.target.value)} placeholder="0.00" />
          </div>
          {item && (
            <div>
              <Label className="text-xs">Actual cost</Label>
              <Input className="mt-1" inputMode="decimal" value={form.actualCost} onChange={(e) => set("actualCost", e.target.value)} placeholder="0.00" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={!form.description.trim() || pending} onClick={submit}>
            {pending ? "Saving…" : item ? "Save item" : "Add item"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ItemSheet({ item, data, canEdit, onClose }: { item: Item | null; data: CaseData; canEdit: boolean; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <Sheet open={Boolean(item)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="font-mono text-muted-foreground">Item {item.itemNumber}</span>
                <Badge className={cn("border-0 text-[11px]", toneClasses(ITEM_STATUS_TONE[item.status] ?? "neutral").pill)}>{ITEM_STATUS_LABEL[item.status]}</Badge>
                {canEdit && (
                  <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4 text-sm">
              <p className="whitespace-pre-wrap">{item.description}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Category</dt>
                <dd>{item.category?.name ?? "—"}</dd>
                <dt className="text-muted-foreground">Code section</dt>
                <dd>{item.codeSection ?? "—"}</dd>
                <dt className="text-muted-foreground">Corrective action</dt>
                <dd className="whitespace-pre-wrap">{item.correctiveAction ?? "—"}</dd>
                <dt className="text-muted-foreground">Trade</dt>
                <dd>{item.responsibleTrade ?? "—"}</dd>
                <dt className="text-muted-foreground">Permit</dt>
                <dd>{PERMIT_OPTIONS.find((o) => o.value === item.permitRequirement)?.label}</dd>
                <dt className="text-muted-foreground">Contractor</dt>
                <dd>{item.contractorName ?? "—"}</dd>
                <dt className="text-muted-foreground">Target / actual</dt>
                <dd>
                  {item.targetCompletionAt ? format(new Date(item.targetCompletionAt), "MMM d, yyyy") : "—"} / {item.actualCompletionAt ? format(new Date(item.actualCompletionAt), "MMM d, yyyy") : "—"}
                </dd>
                <dt className="text-muted-foreground">Est. / actual cost</dt>
                <dd className="tabular-nums">
                  {money(item.estimatedCost)} / {money(item.actualCost)}
                </dd>
                {item.verifiedAt && (
                  <>
                    <dt className="text-muted-foreground">Verified</dt>
                    <dd>{format(new Date(item.verifiedAt), "MMM d, yyyy")}</dd>
                  </>
                )}
              </dl>
              <EntityTaskPanel
                context={{ violationItemId: item.id, violationCaseId: data.id, label: `${data.caseNumber} · Item ${item.itemNumber}`, href: `/violations/${data.id}?tab=items&item=${item.id}` }}
                invalidateKeys={[violationKeys.detail(data.id)]}
                defaultAssigneeId={item.assignedUserId ?? data.caseManagerId ?? null}
                compact
                emptyText="No tasks on this item yet."
              />
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Documents & photos on this item</p>
                <FilesPanel scope={{ leadId: data.leadId, violationCaseId: data.id, violationItemId: item.id }} />
              </div>
            </div>
            <ItemDialog open={editing} onOpenChange={setEditing} caseId={data.id} item={item} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
