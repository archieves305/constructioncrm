"use client";

import { ChevronsDownUp, ChevronsUpDown, Columns3, Rows3, Rows4 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ListScope } from "@/lib/lists/scope";
import type { BoardDensity } from "@/components/shared/use-list-scope";
import { useCollapsedColumns } from "./use-collapsed-columns";
import type { KanbanColumnDef } from "./types";

/**
 * The row above a board: the shared ListToolbar (Mine/All, search, the
 * page's own quick filters) plus density and a Columns menu that folds
 * columns in bulk. It drives the
 * collapse store through the same boardId as the board, so the two stay in
 * sync without a prop.
 */
export function BoardToolbar({
  boardId,
  columns,
  countByColumn,
  closedColumnIds = [],
  scope,
  onScopeChange,
  scopeForced,
  search,
  onSearchChange,
  filters,
  density,
  onDensityChange,
  activeFilterCount,
  onClearFilters,
  mineLabel = "Mine",
}: {
  boardId: string;
  columns: KanbanColumnDef[];
  countByColumn: Map<string, number>;
  closedColumnIds?: string[];
  scope: ListScope;
  onScopeChange: (s: ListScope) => void;
  scopeForced: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  filters?: React.ReactNode;
  density: BoardDensity;
  onDensityChange: (d: BoardDensity) => void;
  activeFilterCount: number;
  onClearFilters: () => void;
  mineLabel?: string;
}) {
  const { setAll, expandAll } = useCollapsedColumns(
    boardId,
    columns.filter((c) => c.defaultCollapsed).map((c) => c.id),
  );
  return (
    <ListToolbar
      scope={scope}
      onScopeChange={onScopeChange}
      scopeForced={scopeForced}
      mineLabel={mineLabel}
      search={search}
      onSearchChange={onSearchChange}
      searchAriaLabel="Search cards"
      filters={filters}
      activeFilterCount={activeFilterCount}
      onClearFilters={onClearFilters}
      trailing={
        <>
          <SegmentedControl<BoardDensity>
            ariaLabel="Card density"
            size="sm"
            value={density}
            onValueChange={onDensityChange}
            options={[
              { value: "COMFORTABLE", label: "", icon: Rows3 },
              { value: "COMPACT", label: "", icon: Rows4 },
            ]}
          />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
              <Columns3 className="size-4" /> Columns
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setAll(columns.map((c) => c.id))}>
                <ChevronsDownUp className="size-4" /> Collapse all
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => expandAll()}>
                <ChevronsUpDown className="size-4" /> Expand all
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAll(columns.filter((c) => (countByColumn.get(c.id) ?? 0) === 0).map((c) => c.id))}>
                Collapse empty columns
              </DropdownMenuItem>
              {closedColumnIds.length > 0 && <DropdownMenuItem onClick={() => setAll(closedColumnIds)}>Collapse closed stages</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}
