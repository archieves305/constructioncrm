"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, Check } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { NOTIFICATION_FILTERS, parseNotificationFilter, type NotificationFilter } from "@/lib/notifications/filters";

type Item = {
  id: string;
  kind: string;
  category: string;
  title: string;
  body: string | null;
  href: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  actionRequired: boolean;
  occurrences: number;
  readAt: string | null;
  emailedAt: string | null;
  lastOccurredAt: string;
};

type Page = { items: Item[]; unreadCount: number; nextCursor: string | null };

const TAB_LABEL: Record<NotificationFilter, string> = {
  all: "All",
  action: "Action required",
  mentions: "Mentions",
  tasks: "Tasks",
  jobs: "Jobs",
};

const CATEGORY_LABEL: Record<string, string> = {
  TASKS: "Task",
  MENTIONS: "Mention",
  REMINDERS: "Reminder",
  ESCALATIONS: "Escalation",
  VIOLATIONS: "Violation",
  JOB_ACTIVITY: "Activity",
};

/**
 * The notification center: everything the CRM has told this person, whether
 * it arrived by email, in a digest, or only here. `?filter=` picks a tab and
 * `?since=` (from a digest's "View all activity" link) narrows to what came
 * in after that moment.
 */
function NotificationsInner() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const filter = parseNotificationFilter(params.get("filter"));
  const since = params.get("since");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const query = useInfiniteQuery<Page>({
    queryKey: ["notifications", "center", filter, since, unreadOnly],
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: "30", filter });
      if (since) q.set("since", since);
      if (unreadOnly) q.set("unread", "true");
      if (pageParam) q.set("cursor", String(pageParam));
      return fetchJson<Page>(`/api/notifications?${q.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const markRead = useMutation({
    mutationFn: (id: string) => fetch(`/api/notifications/${id}/read`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const markAllRead = useMutation({
    mutationFn: () => fetch("/api/notifications/read-all", { method: "POST" }),
    onSuccess: invalidate,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = query.data?.pages[0]?.unreadCount ?? 0;

  const setFilter = (f: NotificationFilter) => {
    const q = new URLSearchParams(params.toString());
    if (f === "all") q.delete("filter");
    else q.set("filter", f);
    router.replace(`/notifications${q.size ? `?${q.toString()}` : ""}`);
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description={
          since
            ? `Activity since ${formatDistanceToNow(new Date(since), { addSuffix: true })}. `
            : "What changed that you need to know about, across tasks, jobs and cases."
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setUnreadOnly((v) => !v)}>
              {unreadOnly ? "Show all" : "Unread only"}
            </Button>
            {unread > 0 && (
              <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()}>
                <Check className="mr-1 h-4 w-4" /> Mark all read
              </Button>
            )}
            <Link href="/settings/notifications" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              Email settings
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {NOTIFICATION_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              filter === f ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABEL[f]}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <ListSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={filter === "action" ? "Nothing needs your attention" : "No notifications yet"}
          description="Task assignments, completions, mentions, violation activity and reminders will show up here as they happen."
        />
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {items.map((n) => (
            <li key={n.id} className={cn("flex gap-3 p-3 text-sm", !n.readAt && "bg-blue-50/60")}>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">{CATEGORY_LABEL[n.category] ?? n.category}</span>
                  {n.actionRequired && !n.readAt && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">Action</span>}
                  {n.priority === "URGENT" && <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">Urgent</span>}
                  <span>{formatDistanceToNow(new Date(n.lastOccurredAt), { addSuffix: true })}</span>
                  {n.occurrences > 1 && <span>· ×{n.occurrences}</span>}
                  {n.emailedAt && <span>· emailed</span>}
                </div>
                <Link
                  href={n.href}
                  onClick={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                  }}
                  className="block"
                >
                  <div className="font-medium text-foreground">{n.title}</div>
                  {n.body && <div className="text-muted-foreground">{n.body}</div>}
                </Link>
              </div>
              {!n.readAt && (
                <button type="button" className="self-start text-xs text-blue-600 hover:underline" onClick={() => markRead.mutate(n.id)}>
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <NotificationsInner />
    </Suspense>
  );
}
