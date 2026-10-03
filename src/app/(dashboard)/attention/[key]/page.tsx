"use client";

import { Suspense, use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityLabel } from "@/components/shared/entity-label";
import { useListScope } from "@/components/shared/use-list-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { ATTENTION_LIST_LIMIT, attentionRow, isAttentionKey, type AttentionList } from "@/lib/attention/rows";
import { fetchJson, HttpError, retryServerErrors } from "@/lib/fetch-json";
import type { ListScope } from "@/lib/lists/scope";

function AttentionListView({ listKey }: { listKey: string }) {
  const { scope, setScope, forced, ready } = useListScope();
  const known = isAttentionKey(listKey) && listKey !== "overdue-tasks";
  const def = known ? attentionRow(listKey) : null;
  const { data, isLoading, error, refetch, isFetching } = useQuery<AttentionList>({
    queryKey: ["attention", listKey, scope],
    queryFn: () => fetchJson(`/api/attention/${listKey}?scope=${scope}`),
    enabled: ready && known,
    retry: retryServerErrors,
  });

  const crumbs = [{ label: "Dashboard", href: "/" }, { label: def?.label ?? "Needs attention" }];
  const toggle = (
    <SegmentedControl<ListScope>
      ariaLabel="Scope"
      size="sm"
      value={scope}
      onValueChange={setScope}
      options={[
        { value: "mine", label: "Mine" },
        { value: "all", label: "All", disabled: forced },
      ]}
    />
  );

  if (!def) {
    return (
      <div>
        <PageHeader title="Needs attention" breadcrumb={crumbs} />
        <EmptyState title="That list does not exist" action={<Link href="/" className="text-sm text-blue-700 hover:underline">Back to the dashboard</Link>} />
      </div>
    );
  }

  const denied = error instanceof HttpError && error.status === 403;
  return (
    <div>
      <PageHeader
        title={data ? `${def.label} · ${data.count}` : def.label}
        description={def.description}
        breadcrumb={crumbs}
        actions={toggle}
      />
      <Card>
        <CardContent className="p-0">
          {isLoading || !ready ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : error ? (
            <EmptyState
              title={denied ? "This list is not available to your role" : "Couldn't load this list"}
              description={denied ? undefined : (error as Error).message}
              action={
                denied ? undefined : (
                  <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                    Try again
                  </Button>
                )
              }
            />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nothing here right now"
              description={scope === "mine" && !forced ? "Nothing on your own work. Switch to All to see the company's." : undefined}
            />
          ) : (
            <>
              <ul className="divide-y">
                {data.items.map((it) => (
                  <li key={it.id}>
                    <Link href={it.href} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <span className="min-w-0 flex-1">
                        <EntityLabel label={{ primary: it.primary, secondary: it.secondary, code: it.code, placeholder: false }} />
                        <span className="mt-0.5 block text-sm text-gray-700">{it.detail}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
              {data.count > data.items.length && (
                <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                  Showing the first {ATTENTION_LIST_LIMIT} of {data.count}.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AttentionListPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AttentionListView listKey={key} />
    </Suspense>
  );
}
