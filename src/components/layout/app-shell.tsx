"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Menu, HardHat, X } from "lucide-react";
import type { RoleName } from "@/generated/prisma/client";
import { Sidebar } from "./sidebar";
import { cn } from "@/lib/utils";

type User = {
  firstName: string;
  lastName: string;
  role: RoleName;
};

export function AppShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden md:block">
        <Sidebar user={user} />
      </div>

      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 transform transition-transform md:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar user={user} />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b bg-white px-4 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded p-2 hover:bg-gray-100"
            aria-label="Open menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2">
            <HardHat className="h-5 w-5 text-blue-600" />
            <span className="text-sm font-bold">Knu Construction</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-gray-50 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
