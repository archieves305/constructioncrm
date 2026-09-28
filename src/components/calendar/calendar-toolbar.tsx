"use client";

import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JobPicker } from "@/components/shared/job-picker";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { PRIORITY_LABEL, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES } from "@/components/tasks/task-colors";
import type { Priority, TaskStatus } from "@/components/tasks/types";
import { activeFilterCount, type CalendarFilters } from "@/lib/calendar/url-state";

const ANY = "__any";

/**
 * Search plus a Filters popover. Deliberately short: job, status, priority,
 * and whether done work still shows. The person you are looking at is the
 * header's job, not a filter.
 */
export function CalendarToolbar({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  onClear,
  trailing,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  filters: CalendarFilters;
  onFiltersChange: (patch: Partial<CalendarFilters>) => void;
  onClear: () => void;
  trailing?: React.ReactNode;
}) {
  const count = activeFilterCount(filters);
  return (
    <ListToolbar
      search={search}
      onSearchChange={onSearchChange}
      searchPlaceholder="Search tasks, jobs, addresses…"
      searchAriaLabel="Search the calendar"
      activeFilterCount={count}
      onClearFilters={onClear}
      filters={
        <Popover>
          <PopoverTrigger
            className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-sm shadow-xs hover:bg-gray-50"
            aria-label={`Filters${count ? `, ${count} active` : ""}`}
          >
            <SlidersHorizontal className="size-4" />
            Filters
            {count > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white">{count}</span>}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3 p-3">
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Job</Label>
              <JobPicker value={filters.job ?? null} onChange={(j) => onFiltersChange({ job: j?.id })} placeholder="Any job" clearable />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Status</Label>
                <Select value={filters.status ?? ANY} onValueChange={(v) => onFiltersChange({ status: !v || v === ANY ? undefined : v })}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue>{(v: string) => (v && v !== ANY ? STATUS_LABEL[v as TaskStatus] : "Any")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any</SelectItem>
                    {TASK_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Priority</Label>
                <Select value={filters.priority ?? ANY} onValueChange={(v) => onFiltersChange({ priority: !v || v === ANY ? undefined : v })}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue>{(v: string) => (v && v !== ANY ? PRIORITY_LABEL[v as Priority] : "Any")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any</SelectItem>
                    {TASK_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={filters.hideCompleted} onCheckedChange={(c) => onFiltersChange({ hideCompleted: Boolean(c) })} />
              Hide done and cancelled
            </label>
            {count > 0 && (
              <Button size="sm" variant="ghost" onClick={onClear}>
                Clear filters
              </Button>
            )}
          </PopoverContent>
        </Popover>
      }
      trailing={trailing}
      className="mb-3"
    />
  );
}
