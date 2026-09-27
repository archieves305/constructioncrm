"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationItem = {
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
  createdAt: string;
  lastOccurredAt: string;
};

type Response = { items: NotificationItem[]; unreadCount: number; nextCursor: string | null };

const CATEGORY_LABEL: Record<string, string> = {
  TASKS: "Task",
  MENTIONS: "Mention",
  REMINDERS: "Reminder",
  ESCALATIONS: "Escalation",
  VIOLATIONS: "Violation",
  JOB_ACTIVITY: "Activity",
};

/**
 * The sidebar bell over the notifications-v2 rows. Every row links into the
 * CRM (the API already resolved the link for this person's role); opening
 * one marks it read. "Action" narrows to unread rows that need something.
 */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "action">("all");

  const { data } = useQuery<Response>({
    queryKey: ["notifications", filter],
    queryFn: () => fetch(`/api/notifications?limit=20&filter=${filter}`).then((r) => r.json()),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const markRead = useMutation({
    mutationFn: (id: string) => fetch(`/api/notifications/${id}/read`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => fetch("/api/notifications/read-all", { method: "POST" }),
    onSuccess: invalidate,
  });

  const unread = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  const openItem = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    router.push(n.href);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent"
      >
        <Bell className="h-4 w-4" />
        <span>Notifications</span>
        {unread > 0 && (
          <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-full bottom-0 z-50 ml-2 w-96 rounded border bg-white shadow-lg">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <h3 className="text-sm font-semibold">Notifications</h3>
              <div className="flex items-center gap-1 text-xs">
                {(["all", "action"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={cn(
                      "rounded px-2 py-0.5",
                      filter === f ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f === "all" ? "All" : "Action"}
                  </button>
                ))}
              </div>
              {unread > 0 && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  onClick={() => markAllRead.mutate()}
                >
                  <Check className="h-3 w-3" />
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {filter === "action" ? "Nothing needs your attention" : "No notifications yet"}
                </p>
              ) : (
                <ul className="divide-y">
                  {items.map((n) => (
                    <li key={n.id} className={cn("p-3 text-sm", !n.readAt && "bg-blue-50")}>
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5">{CATEGORY_LABEL[n.category] ?? n.category}</span>
                        {n.actionRequired && !n.readAt && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">Action</span>
                        )}
                        {n.priority === "URGENT" && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">Urgent</span>
                        )}
                        <span>{formatDistanceToNow(new Date(n.lastOccurredAt), { addSuffix: true })}</span>
                        {n.occurrences > 1 && <span>· ×{n.occurrences}</span>}
                        {!n.readAt && (
                          <button
                            type="button"
                            className="ml-auto text-blue-600 hover:underline"
                            onClick={() => markRead.mutate(n.id)}
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                      <button type="button" onClick={() => openItem(n)} className="block w-full text-left">
                        <div className="font-medium text-foreground">{n.title}</div>
                        {n.body && <div className="line-clamp-2 text-muted-foreground">{n.body}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t px-3 py-2 text-xs">
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={() => {
                  setOpen(false);
                  router.push("/notifications");
                }}
              >
                See all notifications
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
