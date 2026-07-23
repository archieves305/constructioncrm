"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "@/lib/auth/session-client";
import type { RoleName } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { HardHat, LayoutDashboard, LogOut, WifiOff } from "lucide-react";

interface FieldShellProps {
  user: {
    firstName: string;
    lastName: string;
    role: RoleName;
  };
  children: React.ReactNode;
}

// Touch-first chrome for field mode: sticky top bar, generous tap targets,
// bottom-safe-area padding for the fixed action bars pages may render.
// Inputs inside stay ≥16px so iOS Safari doesn't zoom on focus.
export function FieldShell({ user, children }: FieldShellProps) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const isOfficeUser = user.role !== "CREW_LEAD" && user.role !== "READ_ONLY";

  return (
    <div className="flex min-h-dvh flex-col bg-gray-50">
      <header className="sticky top-0 z-40 border-b bg-white">
        <div className="flex h-14 items-center gap-3 px-4">
          <Link href="/field" className="flex items-center gap-2">
            <HardHat className="h-6 w-6 text-blue-600" />
            <span className="text-base font-bold">Field Mode</span>
          </Link>
          <div className="flex-1" />
          {isOfficeUser && (
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Office</span>
              </Button>
            </Link>
          )}
          <span className="text-muted-foreground hidden text-sm sm:inline">
            {user.firstName} {user.lastName}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOut()}
            aria-label="Sign out"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
        {offline && (
          <div className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900">
            <WifiOff className="h-4 w-4 shrink-0" />
            You&apos;re offline — work is saved on this device and will sync when
            you reconnect.
          </div>
        )}
      </header>

      <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  );
}
