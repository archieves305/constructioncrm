"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "./use-labor-sheet";

// Autosave for the daily log's narrative + weather fields. Same layering as
// the labor sheet (debounced local echo + debounced PUT + retry on
// reconnect) but simpler: narrative saves are last-write-wins (no
// baseUpdatedAt) because the labor sheet also bumps the log's updatedAt and
// would make a shared concurrency token trip on our own saves.

export type NarrativeDraft = {
  weatherSummary: string | null;
  weatherTempHighF: number | null;
  weatherTempLowF: number | null;
  weatherPrecipIn: number | null;
  weatherWindMph: number | null;
  weatherSource: string | null;
  workPerformed: string | null;
  areasWorked: string | null;
  materialsDelivered: string | null;
  equipmentUsed: string | null;
  subcontractorsOnsite: string | null;
  inspectionsNotes: string | null;
  delays: string | null;
  safetyIssues: string | null;
  changeOrderItems: string | null;
  ownerInstructions: string | null;
  officeFollowUps: string | null;
  tomorrowPlan: string | null;
  notes: string | null;
  safetyToolboxTalk: boolean;
  safetyPpeVerified: boolean;
  safetyHousekeeping: boolean;
};

export const EMPTY_NARRATIVE: NarrativeDraft = {
  weatherSummary: null,
  weatherTempHighF: null,
  weatherTempLowF: null,
  weatherPrecipIn: null,
  weatherWindMph: null,
  weatherSource: null,
  workPerformed: null,
  areasWorked: null,
  materialsDelivered: null,
  equipmentUsed: null,
  subcontractorsOnsite: null,
  inspectionsNotes: null,
  delays: null,
  safetyIssues: null,
  changeOrderItems: null,
  ownerInstructions: null,
  officeFollowUps: null,
  tomorrowPlan: null,
  notes: null,
  safetyToolboxTalk: false,
  safetyPpeVerified: false,
  safetyHousekeeping: false,
};

const NARRATIVE_KEYS = Object.keys(EMPTY_NARRATIVE) as (keyof NarrativeDraft)[];

export function narrativeFromLog(log: Record<string, unknown> | null): NarrativeDraft {
  if (!log) return EMPTY_NARRATIVE;
  const out = { ...EMPTY_NARRATIVE };
  for (const key of NARRATIVE_KEYS) {
    const v = log[key];
    if (v !== undefined) {
      (out as Record<string, unknown>)[key] =
        typeof v === "string" || typeof v === "number" || typeof v === "boolean"
          ? v
          : v == null
            ? null
            : v;
    }
  }
  return out;
}

const SYNC_DEBOUNCE_MS = 2500;
const RETRY_MS = 30_000;

export function useLogNarrative(
  jobId: string,
  date: string,
  initial: NarrativeDraft | null,
) {
  const [draft, setDraft] = useState<NarrativeDraft | null>(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const draftRef = useRef<NarrativeDraft | null>(initial);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate once when the server log arrives.
  useEffect(() => {
    if (draft === null && initial !== null) {
      setDraft(initial);
      draftRef.current = initial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial === null]);

  const syncNow = useCallback(async (): Promise<boolean> => {
    const current = draftRef.current;
    if (!current || inFlight.current) return false;
    inFlight.current = true;
    setStatus("saving");
    try {
      const res = await fetch(`/api/jobs/${jobId}/daily-logs/${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Survive the page being frozen mid-flight (phone locked).
        keepalive: true,
        body: JSON.stringify(current),
      });
      if (!res.ok) {
        // Narrative PUTs carry no concurrency token, so a 409 always means
        // the log itself refuses edits (submitted/approved).
        setStatus(res.status === 409 ? "locked" : "error");
        return false;
      }
      if (draftRef.current === current) {
        dirty.current = false;
        setStatus("saved");
      }
      return true;
    } catch {
      setStatus("local");
      return false;
    } finally {
      inFlight.current = false;
      if (dirty.current && draftRef.current !== current) {
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => void syncNow(), SYNC_DEBOUNCE_MS);
      }
    }
  }, [jobId, date]);

  const set = useCallback(
    (patch: Partial<NarrativeDraft>) => {
      setDraft((prev) => {
        const next = { ...(prev ?? EMPTY_NARRATIVE), ...patch };
        draftRef.current = next;
        return next;
      });
      dirty.current = true;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => void syncNow(), SYNC_DEBOUNCE_MS);
    },
    [syncNow],
  );

  useEffect(() => {
    const retry = () => {
      if (dirty.current && !inFlight.current) void syncNow();
    };
    // Fire the pending save the moment the page is hidden — iOS freezes the
    // tab on lock/app-switch and the debounce timer may never run.
    const flushHidden = () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      retry();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") retry();
      else flushHidden();
    };
    window.addEventListener("online", retry);
    window.addEventListener("pagehide", flushHidden);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(retry, RETRY_MS);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("pagehide", flushHidden);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [syncNow]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    if (!dirty.current) return true;
    return syncNow();
  }, [syncNow]);

  return { draft: draft ?? EMPTY_NARRATIVE, set, status, flush, ready: draft !== null };
}
