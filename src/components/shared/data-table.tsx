"use client";

import { useCallback, useMemo } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CircleSlash, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { nextSort, parseSort, sortParams, type SortDir, type SortState } from "@/lib/lists/sort";
import { cn } from "@/lib/utils";

/**
 * One table for lists: sortable headers (sort kept in the URL), a sticky
 * header, selection for bulk actions, loading / failed / empty states, and a
 * card per row below 640 px instead of a sideways-scrolling table.
 *
 * Columns carry their own cell renderers, so a page keeps its rich cells
 * (pickers, progress bars) and only describes how each column sorts and how
 * it shows on a phone card.
 */
export type Column<T> = {
  key: string;
  header: React.ReactNode;
  /** The list's sort key (from lib/lists/sort.ts); omit for columns that can't sort. */
  sortKey?: string;
  /** Direction on the first click — money and dates read best high / new first. */
  firstDir?: SortDir;
  cell: (row: T) => React.ReactNode;
  className?: string;
  headClassName?: string;
  /** Hide in the table below `md` (the phone card decides separately). */
  hideBelowMd?: boolean;
  /** Clicks inside this cell don't open the row (pickers, checkboxes). */
  interactive?: boolean;
  /** On a phone card: the title line, a line under it, a "label: value" row, or left out. */
  card?: "title" | "subtitle" | "meta" | "hidden";
  /** The label on a phone card's meta row (defaults to the header when it is text). */
  cardLabel?: string;
};

export type DataTableProps<T> = {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: { state: SortState; onChange: (s: SortState) => void };
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: React.ReactNode;
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void; label: (row: T) => string };
  rowClassName?: (row: T) => string | undefined;
  /** e.g. a max height so the header stays in view while the body scrolls. */
  containerClassName?: string;
  /** Accessible name of the table. */
  caption: string;
};

export function DataTable<T>({ rows, columns, rowKey, onRowClick, sort, loading, error, onRetry, empty, selection, rowClassName, containerClassName, caption }: DataTableProps<T>) {
  const colCount = columns.length + (selection ? 1 : 0);
  const allIds = useMemo(() => (rows ?? []).map(rowKey), [rows, rowKey]);
  const allSelected = !!selection && allIds.length > 0 && allIds.every((id) => selection.selected.has(id));
  const toggleAll = () => selection?.onChange(allSelected ? new Set() : new Set(allIds));
  const toggle = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };

  const state = error ? (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <CircleSlash className="mb-2 size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">Couldn&apos;t load</p>
      <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : "Something went wrong."}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          <RefreshCw className="size-4" /> Try again
        </Button>
      )}
    </div>
  ) : !rows?.length && !loading ? (
    (empty ?? <EmptyState title="Nothing here" />)
  ) : null;

  return (
    <>
      {/* Table: tablets and up */}
      <div className="hidden sm:block">
        <Table containerClassName={containerClassName} aria-label={caption}>
          <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
            <TableRow>
              {selection && (
                <TableHead className="w-8">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all on this page" />
                </TableHead>
              )}
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn(c.hideBelowMd && "hidden md:table-cell", c.headClassName)}
                  aria-sort={sort && c.sortKey && sort.state.key === c.sortKey ? (sort.state.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {sort && c.sortKey ? <SortButton column={c} sort={sort} /> : c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !rows?.length ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={colCount} className="py-2">
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : state ? (
              <TableRow>
                <TableCell colSpan={colCount}>{state}</TableCell>
              </TableRow>
            ) : (
              rows!.map((row) => {
                const id = rowKey(row);
                return (
                  <TableRow
                    key={id}
                    className={cn("h-12", onRowClick && "cursor-pointer hover:bg-surface-subtle", selection?.selected.has(id) && "bg-brand-soft/60", rowClassName?.(row))}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selection && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selection.selected.has(id)} onCheckedChange={() => toggle(id)} aria-label={`Select ${selection.label(row)}`} />
                      </TableCell>
                    )}
                    {columns.map((c) => (
                      <TableCell key={c.key} className={cn(c.hideBelowMd && "hidden md:table-cell", c.className)} onClick={c.interactive ? (e) => e.stopPropagation() : undefined}>
                        {c.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Cards: phones */}
      <div className="space-y-2 sm:hidden">
        {sort && <PhoneSortPicker columns={columns} sort={sort} />}
        {loading && !rows?.length ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
        ) : state ? (
          <div className="rounded-lg border bg-white">{state}</div>
        ) : (
          <ul className="space-y-2" aria-label={caption}>
            {rows!.map((row) => (
              <PhoneCard key={rowKey(row)} row={row} columns={columns} onOpen={onRowClick} selection={selection} id={rowKey(row)} onToggle={toggle} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function SortButton<T>({ column, sort }: { column: Column<T>; sort: NonNullable<DataTableProps<T>["sort"]> }) {
  const active = sort.state.key === column.sortKey;
  const Icon = !active ? ArrowUpDown : sort.state.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className={cn("-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", active && "text-foreground")}
      onClick={() => sort.onChange(nextSort(sort.state, column.sortKey!, column.firstDir))}
    >
      {column.header}
      <Icon className={cn("size-3.5", !active && "text-muted-foreground")} aria-hidden />
      <span className="sr-only">{active ? `, sorted ${sort.state.dir === "asc" ? "ascending" : "descending"}` : ", sort"}</span>
    </button>
  );
}

function PhoneSortPicker<T>({ columns, sort }: { columns: Column<T>[]; sort: NonNullable<DataTableProps<T>["sort"]> }) {
  const sortable = columns.filter((c) => c.sortKey);
  if (!sortable.length) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="phone-sort" className="text-muted-foreground">
        Sort
      </label>
      <select
        id="phone-sort"
        className="h-11 flex-1 rounded-lg border border-input bg-white px-2"
        value={`${sort.state.key}:${sort.state.dir}`}
        onChange={(e) => {
          const [key, dir] = e.target.value.split(":");
          sort.onChange({ key, dir: dir as SortDir });
        }}
      >
        {sortable.flatMap((c) => {
          const name = typeof c.header === "string" ? c.header : c.cardLabel ?? c.key;
          return [
            <option key={`${c.sortKey}:asc`} value={`${c.sortKey}:asc`}>{`${name}, ascending`}</option>,
            <option key={`${c.sortKey}:desc`} value={`${c.sortKey}:desc`}>{`${name}, descending`}</option>,
          ];
        })}
      </select>
    </div>
  );
}

function PhoneCard<T>({ row, columns, onOpen, selection, id, onToggle }: { row: T; columns: Column<T>[]; onOpen?: (row: T) => void; selection?: DataTableProps<T>["selection"]; id: string; onToggle: (id: string) => void }) {
  const title = columns.find((c) => c.card === "title") ?? columns[0];
  const subtitles = columns.filter((c) => c.card === "subtitle");
  const meta = columns.filter((c) => c !== title && (c.card === "meta" || c.card === undefined));
  return (
    <li className={cn("rounded-lg border bg-white p-3", selection?.selected.has(id) && "border-brand bg-brand-soft/40")}>
      <div className="flex items-start gap-2">
        {selection && (
          <Checkbox className="mt-1" checked={selection.selected.has(id)} onCheckedChange={() => onToggle(id)} aria-label={`Select ${selection.label(row)}`} />
        )}
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button type="button" className="block w-full text-left font-medium" onClick={() => onOpen(row)}>
              {title.cell(row)}
            </button>
          ) : (
            <div className="font-medium">{title.cell(row)}</div>
          )}
          {subtitles.map((c) => (
            <div key={c.key} className="mt-0.5 text-sm text-muted-foreground">
              {c.cell(row)}
            </div>
          ))}
        </div>
      </div>
      {meta.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
          {meta.map((c) => (
            <div key={c.key} className="contents">
              <dt className="text-xs text-muted-foreground">{c.cardLabel ?? (typeof c.header === "string" ? c.header : c.key)}</dt>
              <dd className="min-w-0">{c.cell(row)}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/** The list's sort from the URL, and a setter that writes it back (default = clean URL). */
export function useListSort<K extends string>(keys: readonly K[], fallback: SortState<K>, onChange?: () => void) {
  const url = useSearchParamState();
  const state = parseSort(url.params, keys, fallback);
  const set = useCallback(
    (s: SortState) => {
      url.setMany(sortParams(s as SortState<K>, fallback));
      onChange?.();
    },
    [url, fallback, onChange],
  );
  return { state, onChange: set } as { state: SortState<K>; onChange: (s: SortState) => void };
}
