import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/auth/session";
import { restoreSavedCopy, writeSavedCopy } from "./persist";
import { warmDue } from "./rules";
import { warmSavedCopy } from "./warm";
import { track } from "@/usage/track";

/**
 * Restores the signed-in person's saved copy before the screens open, keeps
 * it written as the CRM answers (two seconds after the last change), and
 * refreshes it in the background when the app comes forward or signal
 * returns, at most every 15 minutes.
 */
export function CacheProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { status, user } = useSession();
  const userId = status === "signedIn" ? user?.id ?? null : null;
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const lastWarm = useRef<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    track("app_opened");
    let live = true;
    restoreSavedCopy(qc, userId)
      .catch(() => 0)
      .finally(() => live && setRestoredFor(userId));
    return () => {
      live = false;
    };
  }, [qc, userId]);

  useEffect(() => {
    if (!userId || restoredFor !== userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = qc.getQueryCache().subscribe((e) => {
      if (e.type !== "updated" && e.type !== "removed") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void writeSavedCopy(qc, userId).catch(() => undefined), 2000);
    });
    const warm = () => {
      if (!warmDue(lastWarm.current, Date.now(), onlineManager.isOnline())) return;
      lastWarm.current = Date.now();
      void warmSavedCopy(qc, userId).catch(() => undefined);
    };
    warm();
    const app = AppState.addEventListener("change", (s) => s === "active" && warm());
    const net = onlineManager.subscribe((online) => online && warm());
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
      app.remove();
      net();
    };
  }, [qc, userId, restoredFor]);

  // Hold the screens until the saved copy is in (a few milliseconds), so they open on it.
  if (userId && restoredFor !== userId) return null;
  return <>{children}</>;
}
