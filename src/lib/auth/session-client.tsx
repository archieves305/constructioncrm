"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { RoleName } from "@/generated/prisma/client";

/**
 * Client-side session access, replacing next-auth/react.
 *
 * Deliberately API-compatible with what the app already used —
 * `const { data: session } = useSession()` and `session?.user?.role` — so the
 * consumers only had to change their import line. Fed by /api/me, which
 * resolves the live SSO identity server-side.
 */

export interface ClientSessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: RoleName;
}

export interface ClientSession {
  user: ClientSessionUser;
}

type Status = "loading" | "authenticated" | "unauthenticated";

const SessionContext = createContext<{
  data: ClientSession | null;
  status: Status;
}>({ data: null, status: "loading" });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<ClientSession | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: ClientSession | null) => {
        if (cancelled) return;
        if (body?.user) {
          setData(body);
          setStatus("authenticated");
        } else {
          setData(null);
          setStatus("unauthenticated");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setStatus("unauthenticated");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SessionContext.Provider value={{ data, status }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

/**
 * End the session. The cookie is `.careyos.com`-scoped and owned by the portal,
 * so signing out is a full-fleet action handled there — the CRM cannot expire
 * it locally.
 */
export function signOut() {
  window.location.href = "/api/auth/sign-out";
}
