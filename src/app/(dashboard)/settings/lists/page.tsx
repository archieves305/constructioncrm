"use client";

import { PageHeader } from "@/components/shared/page-header";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useSession } from "@/lib/auth/session-client";
import { isScopeForced, type ListScopePref } from "@/lib/lists/scope";
import { useMePreferences, usePatchPreferences, type BoardDensity } from "@/components/shared/use-list-scope";

export default function ListSettingsPage() {
  const { data: session } = useSession();
  const { data: prefs, isLoading } = useMePreferences();
  const patch = usePatchPreferences();
  const forced = session ? isScopeForced(session.user.role) : false;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Lists & boards" description="What the jobs and leads pages open on, and how dense the boards are." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Defaults</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {isLoading || !prefs ? (
            <div className="p-6"><ListSkeleton rows={2} /></div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Default view</p>
                  <p className="text-xs text-muted-foreground">
                    {forced
                      ? "Your role always sees the jobs and leads you are on."
                      : "Mine shows jobs you have a role on (rep, PM, workflow team, field, crew) and leads assigned to you. You can switch on any page; the switch is remembered here."}
                  </p>
                </div>
                <SegmentedControl<ListScopePref>
                  ariaLabel="Default view"
                  size="sm"
                  value={forced ? "MINE" : prefs.defaultListScope}
                  onValueChange={(v) => patch.mutate({ defaultListScope: v })}
                  options={[
                    { value: "MINE", label: "Mine" },
                    { value: "ALL", label: "All", disabled: forced },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Board density</p>
                  <p className="text-xs text-muted-foreground">Compact cards drop the address, next-action note and deposit bar so more fit in a column.</p>
                </div>
                <SegmentedControl<BoardDensity>
                  ariaLabel="Board density"
                  size="sm"
                  value={prefs.boardDensity}
                  onValueChange={(v) => patch.mutate({ boardDensity: v })}
                  options={[
                    { value: "COMFORTABLE", label: "Comfortable" },
                    { value: "COMPACT", label: "Compact" },
                  ]}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
