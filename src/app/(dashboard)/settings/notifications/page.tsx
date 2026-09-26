"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { toast } from "sonner";
import { Bell, BellRing, AlarmClock, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";

type Prefs = {
  taskEmailsEnabled: boolean;
  escalationEmailsEnabled: boolean;
  reminderDigestEnabled: boolean;
  nudgeEmailsEnabled: boolean;
};

const ROWS: { key: keyof Prefs; icon: React.ElementType; title: string; help: string; sub?: boolean }[] = [
  {
    key: "taskEmailsEnabled",
    icon: Bell,
    title: "Task emails",
    help: "Assignments, completions, blocked tasks and @mentions. Turning this off silences everything below too.",
  },
  {
    key: "reminderDigestEnabled",
    icon: AlarmClock,
    title: "Morning digest and reminders",
    help: "One email each weekday morning with what is overdue, due today, and any “remind me on” dates.",
    sub: true,
  },
  {
    key: "escalationEmailsEnabled",
    icon: TriangleAlert,
    title: "Overdue escalations",
    help: "When a task you raised goes days overdue, or as a manager when any task does.",
    sub: true,
  },
  {
    key: "nudgeEmailsEnabled",
    icon: BellRing,
    title: "Nudges",
    help: "“Checking in” messages from the person waiting on a task of yours.",
    sub: true,
  },
];

export default function NotificationSettingsPage() {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useQuery<Prefs>({
    queryKey: ["me-preferences"],
    queryFn: () => fetchJson("/api/me/preferences"),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<Prefs>) =>
      fetchJson<Prefs>("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me-preferences"] });
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message || "Could not save that"),
  });

  const master = prefs?.taskEmailsEnabled ?? true;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Notifications" description="Which task emails reach your inbox." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {isLoading || !prefs ? (
            <div className="p-6"><ListSkeleton rows={2} /></div>
          ) : (
            ROWS.map((row) => {
              const Icon = row.icon;
              const disabled = (row.sub && !master) || save.isPending;
              return (
                <label
                  key={row.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 px-6 py-4",
                    row.sub && "pl-12",
                    disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={prefs[row.key]}
                    disabled={disabled}
                    onCheckedChange={(c) => save.mutate({ [row.key]: Boolean(c) })}
                  />
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{row.title}</span>
                    <span className="block text-xs text-muted-foreground">{row.help}</span>
                  </span>
                </label>
              );
            })
          )}
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        Task email is internal work assignment rather than marketing, so there is no unsubscribe link in the
        messages themselves; this page is the switch.
      </p>
    </div>
  );
}
