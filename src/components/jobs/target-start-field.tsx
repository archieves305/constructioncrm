"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useInvalidateWorkflow } from "@/components/workflows/use-workflow";
import { fetchJson } from "@/lib/fetch-json";

/**
 * The job's target start date, editable in place. The date is a day, not an
 * instant: it is read off the stored value's UTC date (the server pins a bare
 * `yyyy-MM-dd` to noon UTC) so it never slips a day in the viewer's zone.
 * Saving goes through the job PATCH, which shifts the workflow steps anchored
 * on the target start.
 */
export function TargetStartField({
  jobId,
  value,
  canEdit,
  hasWorkflow,
}: {
  jobId: string;
  value: string | null;
  canEdit: boolean;
  hasWorkflow: boolean;
}) {
  const current = value ? value.slice(0, 10) : "";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current);
  const invalidate = useInvalidateWorkflow({ kind: "job", id: jobId });

  const save = useMutation({
    mutationFn: (day: string | null) =>
      fetchJson(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetStartDate: day }),
      }),
    onSuccess: (_data, day) => {
      invalidate([["calendar"]]);
      setOpen(false);
      toast.success(
        day
          ? `Start date set to ${format(parseISO(day), "MMM d, yyyy")}${hasWorkflow ? " — workflow steps tied to it were rescheduled" : ""}`
          : "Start date cleared",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Could not save the start date"),
  });

  const label = current ? `Starts ${format(parseISO(current), "MMM d, yyyy")}` : "Set start date";

  if (!canEdit) {
    if (!current) return null;
    return (
      <span className="inline-flex items-center gap-1">
        <CalendarDays className="size-3.5" aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(current);
        setOpen(o);
      }}
    >
      <PopoverTrigger
        aria-label={current ? `${label}. Change the target start date` : "Set the target start date"}
        className="inline-flex items-center gap-1 rounded-sm text-brand-fg hover:underline"
      >
        <CalendarDays className="size-3.5" aria-hidden />
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft && draft !== current) save.mutate(draft);
          }}
        >
          <div>
            <Label htmlFor="job-target-start" className="text-xs">
              Target start date
            </Label>
            <Input
              id="job-target-start"
              type="date"
              className="mt-1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {hasWorkflow && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Open workflow steps counted from the start date move with it.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            {/* Clearing would strip the due date from every open step anchored on it. */}
            {current && !hasWorkflow ? (
              <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" disabled={save.isPending} onClick={() => save.mutate(null)}>
                Clear
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" variant="brand" disabled={save.isPending || !draft || draft === current}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
