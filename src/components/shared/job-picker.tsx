"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, ChevronsUpDown, X } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { jobLabel } from "@/lib/labels/job";
import { cn } from "@/lib/utils";
import type { JobLabel } from "@/components/tasks/types";
import { useDebouncedValue } from "./use-debounced-value";
import { EntityLabel } from "./entity-label";

export type JobPickerOption = JobLabel & { currentStage?: { id: string; name: string } };

/**
 * Find a job the way people think of it: type part of the address, the
 * customer, the job number or a phone number. Server-searched through
 * `/api/jobs?search=`, so the same scoping as the jobs list applies.
 */
export function JobPicker({
  value,
  onChange,
  leadId,
  placeholder = "Any job",
  clearable = true,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (job: JobPickerOption | null) => void;
  leadId?: string;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q.trim(), 200);
  const scope = leadId ? `&leadId=${encodeURIComponent(leadId)}` : "";

  const { data, isFetching } = useQuery<{ data: JobPickerOption[] }>({
    queryKey: ["jobs", "picker", dq, leadId ?? null],
    queryFn: () => fetchJson(`/api/jobs?pageSize=20${scope}${dq ? `&search=${encodeURIComponent(dq)}` : ""}`),
    enabled: open,
    retry: retryServerErrors,
    staleTime: 30_000,
  });
  const rows = data?.data ?? [];

  // The chosen job may not be in the current page (URL-seeded ids, an old
  // search); fetch it on its own so the trigger can name it.
  const chosenInRows = rows.find((j) => j.id === value) ?? null;
  const { data: chosen } = useQuery<JobPickerOption>({
    queryKey: ["job", "picker", value],
    queryFn: () => fetchJson(`/api/jobs/${value}`),
    enabled: !!value && !chosenInRows,
    retry: retryServerErrors,
    staleTime: 60_000,
  });
  const current = chosenInRows ?? (chosen && chosen.id === value ? chosen : null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label="Job"
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border bg-white px-3 text-left text-sm shadow-xs hover:bg-gray-50 disabled:opacity-50",
          className,
        )}
      >
        <Briefcase className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {value ? (
            current ? (
              <EntityLabel label={jobLabel(current, { customer: false })} inline />
            ) : (
              <span className="text-muted-foreground">Loading…</span>
            )
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        {value && clearable ? (
          <span
            role="button"
            aria-label="Clear job"
            className="rounded p-0.5 text-muted-foreground hover:bg-gray-200 hover:text-gray-900"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onChange(null);
            }}
          >
            <X className="size-3.5" />
          </span>
        ) : (
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--anchor-width)] min-w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Search address, customer, job #, phone…" />
          <CommandList>
            {rows.length === 0 && <CommandEmpty>{isFetching ? "Searching…" : dq ? "No job matches." : "No jobs yet."}</CommandEmpty>}
            {rows.length > 0 && (
              <CommandGroup heading={dq ? "Matches" : "Recent jobs"}>
                {rows.map((j) => (
                  <CommandItem
                    key={j.id}
                    value={j.id}
                    onSelect={() => {
                      onChange(j);
                      setOpen(false);
                      setQ("");
                    }}
                    className={cn("flex items-start gap-2", value === j.id && "bg-brand/5")}
                  >
                    <EntityLabel label={jobLabel(j)} className="min-w-0 flex-1" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
