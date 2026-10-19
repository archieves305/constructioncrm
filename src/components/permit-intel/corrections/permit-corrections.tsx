"use client";

import { useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import type { PermitDetail } from "../types";
import { DraftForm, MessageEditor, MessagesCard } from "./messages";
import { NoticeAddForm } from "./notice-add-dialog";
import { NoticeCard } from "./notice-card";
import type { PermitMessage } from "./types";
import { useCorrections } from "./use-corrections";

/**
 * The permit's Corrections tab: each notice the building department sent,
 * read by the AI into items a person confirms, then worked to the response
 * letter and the resubmission; and the emails asking the architect, engineer
 * or owner for what they must revise.
 */
export function PermitCorrections({ detail }: { detail: PermitDetail }) {
  const { permit, files } = detail;
  const { data, isLoading, error } = useCorrections(permit.id);
  const [adding, setAdding] = useState(false);
  const [drafting, setDrafting] = useState<string[] | null>(null);
  const [open, setOpen] = useState<PermitMessage | null>(null);

  if (isLoading) return <ListSkeleton rows={3} />;
  if (error || !data) return <Callout tone="danger" title="The corrections did not load">{(error as Error | null)?.message ?? "Try again in a moment."}</Callout>;

  const allItems = data.notices.flatMap((n) => n.items);
  const latest = permit.cycles[0] ?? null;
  const canAdd = data.permissions.canEdit && !!latest && (latest.outcome === "PENDING" || latest.outcome === "CORRECTIONS");
  const toCheck = data.notices.filter((n) => n.status === "REVIEW" || n.status === "FAILED").length;
  const openItems = allItems.filter((i) => i.status === "OPEN" || i.status === "WAITING_THIRD_PARTY" || i.status === "DISPUTED").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {[toCheck ? `${toCheck} notice${toCheck === 1 ? "" : "s"} to check.` : null, openItems ? `${openItems} correction${openItems === 1 ? "" : "s"} still open.` : data.notices.length && !toCheck ? "No corrections open." : null].filter(Boolean).join(" ")}
        </p>
        {canAdd && (
          <Button size="sm" variant="brand" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add a correction notice
          </Button>
        )}
      </div>
      {!latest && data.permissions.canEdit && (
        <Callout tone="info" title="Nothing has been submitted yet">
          A correction notice answers a submission. Record the submission on the Submissions tab first.
        </Callout>
      )}

      {data.notices.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No corrections" description="When the building department asks for corrections, add its notice here. The AI lists each comment; you check them, and they become tasks and the lines of your response letter." />
      ) : (
        data.notices.map((n) => <NoticeCard key={n.id} notice={n} permitId={permit.id} permissions={data.permissions} parties={permit.parties} files={files} onDraftEmail={setDrafting} />)
      )}

      <MessagesCard data={data} onOpen={setOpen} onNew={() => setDrafting([])} />

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">{adding && <NoticeAddForm permitId={permit.id} aiReady={data.permissions.aiReady} onClose={() => setAdding(false)} />}</DialogContent>
      </Dialog>
      <Dialog open={!!drafting} onOpenChange={(o) => !o && setDrafting(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {drafting && (
            <DraftForm
              permitId={permit.id}
              items={allItems.filter((i) => drafting.includes(i.id))}
              parties={permit.parties}
              aiReady={data.permissions.aiReady}
              onClose={() => setDrafting(null)}
              onCreated={(m) => {
                setDrafting(null);
                setOpen(m);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {open && <MessageEditor key={open.id} message={open} permitId={permit.id} files={files} items={allItems} canSend={data.permissions.canSend} onClose={() => setOpen(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
