"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationItem = {
  id: string;
  channel: "SMS" | "EMAIL" | "IN_APP";
  messageBody: string;
  status: string;
  readAt: string | null;
  createdAt: string;
  lead: { id: string; fullName: string } | null;
};

type Response = { items: NotificationItem[]; unreadCount: number };

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<Response>({
    queryKey: ["notifications"],
    queryFn: () => fetch("/api/notifications?limit=20").then((r) => r.json()),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const markRead = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => fetch("/api/notifications/read-all", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

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
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute left-full bottom-0 z-50 ml-2 w-96 rounded border bg-white shadow-lg">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h3 className="text-sm font-semibold">Notifications</h3>
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
                  No notifications yet
                </p>
              ) : (
                <ul className="divide-y">
                  {items.map((n) => (
                    <li
                      key={n.id}
                      className={cn(
                        "p-3 text-sm",
                        !n.readAt && "bg-blue-50",
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {n.channel}
                        </span>
                        <span>
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </span>
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
                      <div className="line-clamp-3 whitespace-pre-wrap text-foreground">
                        {n.messageBody}
                      </div>
                      {n.lead && (
                        <Link
                          href={`/leads/${n.lead.id}`}
                          className="mt-1 inline-block text-xs text-blue-600 hover:underline"
                          onClick={() => setOpen(false)}
                        >
                          Lead: {n.lead.fullName}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
