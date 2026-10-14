"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { toast } from "sonner";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { useOptimisticMove } from "@/components/kanban/use-optimistic-move";
import type { KanbanColumnDef } from "@/components/kanban/types";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { UserAvatar } from "@/components/shared/user-avatar";
import { fetchJson } from "@/lib/fetch-json";
import { lastTouchLabel } from "@/lib/partners/derive";
import { stagesAsStageLike, stageNeedsReason } from "@/lib/partners/stages";
import { buildStageToneMap } from "@/lib/ui/stage-colors";
import { cn } from "@/lib/utils";
import { OrgBadges, PriorityBadge } from "./stage-badges";
import type { OrgList, OrgRow, PartnerStage } from "./use-partners";

const STAGES = stagesAsStageLike();

/** Accounts by relationship stage. Dropping one on "Do not pursue" asks for the reason first. */
export function PartnerBoard({ queryKey, rows, isLoading, canManage, canAdmin, resetKey }: { queryKey: readonly unknown[]; rows: OrgRow[]; isLoading: boolean; canManage: boolean; canAdmin: boolean; resetKey: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [pendingWriteOff, setPendingWriteOff] = useState<OrgRow | null>(null);

  const move = useOptimisticMove<OrgList, { id: string; toColumnId: string; reason?: string }>({
    queryKey: [...queryKey],
    mutationFn: ({ id, toColumnId, reason }) =>
      fetchJson(`/api/partners/${id}/stage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: toColumnId, reason }) }),
    applyOptimistic: (old, { id, toColumnId }) => (old ? { ...old, rows: old.rows.map((r) => (r.id === id ? { ...r, stage: toColumnId as PartnerStage } : r)) } : old),
    invalidate: [["partners"], ["tasks"]],
    messages: { success: "Account moved", error: "Could not move the account" },
  });

  const columns = useMemo<KanbanColumnDef[]>(() => {
    const tones = buildStageToneMap(STAGES);
    return STAGES.map((s) => ({ id: s.id, title: s.name, tone: tones.get(s.id)!, defaultCollapsed: Boolean(s.isClosed) }));
  }, []);

  const onMove = (id: string, toColumnId: string) => {
    if (!canManage) return;
    if (stageNeedsReason(toColumnId as PartnerStage)) {
      if (!canAdmin) return toast.error("Only a manager can mark an account Do not pursue");
      const row = rows.find((r) => r.id === id);
      if (row) setPendingWriteOff(row);
      return;
    }
    move.mutate({ id, toColumnId });
  };

  return (
    <>
      <KanbanBoard<OrgRow>
        boardId="partners"
        columns={columns}
        items={rows}
        isLoading={isLoading}
        getColumnId={(r) => r.stage}
        renderCard={(r, s) => <PartnerCard row={r} compact={s.density === "compact"} />}
        onMove={onMove}
        canMove={() => canManage}
        onOpen={(r) => router.push(`/partners/${r.id}`)}
        columnWidth={280}
        emptyLabel="No accounts here"
        resetKey={resetKey}
      />
      <ConfirmDialog
        open={Boolean(pendingWriteOff)}
        onOpenChange={(o) => !o && setPendingWriteOff(null)}
        title={`Stop pursuing ${pendingWriteOff?.name ?? "this account"}?`}
        description="It leaves the board's open columns and raises no more follow-ups. The reason stays on the account's history."
        tone="warning"
        confirmLabel="Do not pursue"
        requireReason
        reasonLabel="Why"
        pending={move.isPending}
        onConfirm={async (reason) => {
          if (!pendingWriteOff) return;
          await move.mutateAsync({ id: pendingWriteOff.id, toColumnId: "DO_NOT_PURSUE", reason });
          setPendingWriteOff(null);
          qc.invalidateQueries({ queryKey: ["partners"] });
        }}
      />
    </>
  );
}

function PartnerCard({ row, compact }: { row: OrgRow; compact: boolean }) {
  const now = new Date();
  const touch = lastTouchLabel(row.lastContactAt, now);
  const quiet = row.badges.some((b) => b.key === "quiet" || b.key === "never-contacted");
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-gray-900">{row.name}</p>
        <PriorityBadge priority={row.priority} />
      </div>
      {!compact && row.primaryContact && (
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          {row.primaryContact.phone && <Phone className="size-3 shrink-0" />}
          {row.primaryContact.name}
        </p>
      )}
      <p className={cn("text-xs", quiet ? "font-medium text-tone-warning-fg" : "text-muted-foreground")}>Last touch {touch}</p>
      {!compact && <OrgBadges badges={row.badges} max={2} />}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <UserAvatar user={row.owner} size="sm" />
          <span className="truncate">{row.owner ? `${row.owner.firstName} ${row.owner.lastName.charAt(0)}.` : "No owner"}</span>
        </span>
        {row.nextOpenTask && <span className="truncate text-[11px] text-muted-foreground">{row.nextOpenTask.title}</span>}
      </div>
    </div>
  );
}
