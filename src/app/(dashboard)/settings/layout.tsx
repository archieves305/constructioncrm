"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LayoutList } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/lists", label: "Lists & boards", icon: LayoutList },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div>
      <nav className="mx-auto mb-4 flex max-w-2xl gap-1 border-b" aria-label="Settings">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors",
                active ? "border-brand text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900",
              )}
            >
              <Icon className="size-4" /> {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
