import type { StageTone } from "@/lib/ui/stage-colors";

export type KanbanColumnDef = {
  id: string;
  title: string;
  tone: StageTone;
  /** e.g. "$412,300 · 2 overdue" */
  aggregate?: React.ReactNode;
  defaultCollapsed?: boolean;
  /** Soft WIP limit: the count badge turns warning-toned above it. */
  limit?: number;
};

export type CardDensity = "comfortable" | "compact";

export type CardRenderState = { dragging: boolean; overlay: boolean; density: CardDensity };

export type KanbanBoardProps<T extends { id: string }> = {
  /** Namespaces the collapsed-column memory in localStorage. */
  boardId: string;
  columns: KanbanColumnDef[];
  items: T[];
  getColumnId: (item: T) => string;
  renderCard: (item: T, state: CardRenderState) => React.ReactNode;
  onMove: (itemId: string, toColumnId: string, fromColumnId: string) => void;
  onOpen?: (item: T) => void;
  /** Return false to refuse a move (the caller may open a dialog instead). */
  canMove?: (item: T, toColumnId: string) => boolean;
  /** true = drag from a grip only (cards with inline controls). */
  dragHandle?: boolean;
  columnWidth?: number;
  heightClassName?: string;
  emptyLabel?: string;
  isLoading?: boolean;
  /** Cards shown per column before a "Show more" button. */
  maxVisiblePerColumn?: number;
  density?: CardDensity;
  /** When this changes (filters, scope), every column's "shown" count resets. */
  resetKey?: string;
  /** Rendered above the columns — e.g. "Showing 500 of 640". */
  notice?: React.ReactNode;
};
