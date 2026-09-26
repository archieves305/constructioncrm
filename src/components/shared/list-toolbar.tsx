"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ListScope } from "@/lib/lists/scope";
import { cn } from "@/lib/utils";

/**
 * The row above any list or board: Mine/All (when the list has a scope),
 * search, the page's own quick filters, a reset, and whatever the page
 * puts on the right (density, columns, export). One shape everywhere so the
 * eye finds the same things in the same places.
 */
export function ListToolbar({
  scope,
  onScopeChange,
  scopeForced = false,
  mineLabel = "Mine",
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  searchAriaLabel = "Search",
  filters,
  activeFilterCount = 0,
  onClearFilters,
  trailing,
  className,
}: {
  scope?: ListScope;
  onScopeChange?: (s: ListScope) => void;
  scopeForced?: boolean;
  mineLabel?: string;
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  filters?: React.ReactNode;
  activeFilterCount?: number;
  onClearFilters?: () => void;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-center gap-2", className)}>
      {scope && onScopeChange && (
        <SegmentedControl<ListScope>
          ariaLabel="Scope"
          size="sm"
          value={scope}
          onValueChange={onScopeChange}
          options={[
            { value: "mine", label: mineLabel },
            { value: "all", label: "All", disabled: scopeForced },
          ]}
        />
      )}
      {onSearchChange && (
        <div className="relative w-full min-w-40 flex-1 sm:w-auto sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search ?? ""} onChange={(e) => onSearchChange(e.target.value)} placeholder={searchPlaceholder} className="h-8 pl-8" aria-label={searchAriaLabel} />
        </div>
      )}
      {filters}
      {activeFilterCount > 0 && onClearFilters && (
        <Button size="sm" variant="ghost" onClick={onClearFilters}>
          <X className="size-3.5" /> Reset ({activeFilterCount})
        </Button>
      )}
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
}
