"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckSquare, HardHat } from "lucide-react";
import { useTaskSummary } from "@/components/tasks/use-tasks";
import { cn } from "@/lib/utils";

/**
 * Thumb-reach navigation for field mode: Jobs and Tasks.
 *
 * Rendered only on the home and task screens. The daily-log page owns a fixed
 * bottom action bar of its own, and two bars fighting for the same strip is
 * worse than none — so this hides itself anywhere else.
 */
const SHOW_ON = [/^\/field$/, /^\/field\/tasks(\/.*)?$/];

export function FieldBottomNav() {
  const pathname = usePathname();
  const visible = SHOW_ON.some((re) => re.test(pathname));
  const { data } = useTaskSummary({ enabled: visible });
  if (!visible) return null;

  const items = [
    { href: "/field", label: "Jobs", icon: HardHat, active: pathname === "/field", count: 0, alert: false },
    {
      href: "/field/tasks",
      label: "Tasks",
      icon: CheckSquare,
      active: pathname.startsWith("/field/tasks"),
      count: data?.open ?? 0,
      alert: (data?.overdue ?? 0) > 0,
    },
  ];

  return (
    <nav
      aria-label="Field navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto grid max-w-3xl grid-cols-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={it.active ? "page" : undefined}
              className={cn(
                "relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                it.active ? "text-blue-700" : "text-gray-500 hover:text-gray-800",
              )}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {it.count > 0 && (
                  <span
                    className={cn(
                      "absolute -right-2.5 -top-1.5 min-w-4 rounded-full px-1 text-[10px] font-semibold leading-4 text-white",
                      it.alert ? "bg-red-600" : "bg-gray-700",
                    )}
                  >
                    {it.count}
                  </span>
                )}
              </span>
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
