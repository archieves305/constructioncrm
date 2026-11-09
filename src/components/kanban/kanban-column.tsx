"use client";

import { useDroppable } from "@dnd-kit/core";
import { ChevronsLeftRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { KanbanColumnDef } from "./types";

export function KanbanColumn({
  column,
  count,
  collapsed,
  onToggle,
  width,
  heightClassName,
  children,
}: {
  column: KanbanColumnDef;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  width: number;
  heightClassName: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "flex w-10 shrink-0 snap-start flex-col items-center rounded-xl bg-surface-muted/80 ring-1 ring-border/80 transition",
          heightClassName,
          isOver && "bg-brand/5 ring-2 ring-brand/50",
        )}
      >
        <div className={cn("h-1 w-full rounded-t-xl", column.tone.bar)} />
        <button
          type="button"
          onClick={onToggle}
          title={`Expand ${column.title}`}
          className="mt-2 rounded p-1 text-muted-foreground hover:bg-white hover:text-foreground"
        >
          <ChevronsLeftRight className="size-3.5" />
        </button>
        <span className="mt-2 text-xs font-semibold tabular-nums text-fg-secondary">{count}</span>
        <span className="mt-3 rotate-180 whitespace-nowrap text-xs font-medium text-fg-secondary [writing-mode:vertical-rl]">
          {column.title}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{ width }}
      className={cn(
        "flex shrink-0 snap-start flex-col rounded-xl bg-surface-muted/80 ring-1 ring-border/80 transition",
        heightClassName,
        isOver && "bg-brand/5 ring-2 ring-brand/50",
      )}
    >
      <div className={cn("h-1 shrink-0 rounded-t-xl", column.tone.bar)} />
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">
        <span className={cn("size-2 shrink-0 rounded-full", column.tone.dot)} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{column.title}</h3>
        <Badge
          variant="secondary"
          className={cn("tabular-nums", column.limit != null && count > column.limit && "bg-tone-warning-soft text-tone-warning-fg")}
          title={column.limit != null && count > column.limit ? `Over the ${column.limit}-card limit` : undefined}
        >
          {count}
        </Badge>
        <button
          type="button"
          onClick={onToggle}
          title={`Collapse ${column.title}`}
          className="rounded p-1 text-muted-foreground hover:bg-white hover:text-foreground"
        >
          <ChevronsLeftRight className="size-3.5" />
        </button>
      </div>
      {column.aggregate && (
        <div className="shrink-0 px-3 pb-2 text-xs tabular-nums text-muted-foreground">{column.aggregate}</div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-2">{children}</div>
      </ScrollArea>
    </div>
  );
}
