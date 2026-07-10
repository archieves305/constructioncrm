"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearLaborDraft,
  loadLaborDraft,
  requestPersistence,
  saveLaborDraft,
} from "@/lib/field-store";

// Autosave state machine for one (job, date) labor sheet.
//
// Durability layers:
//   1. Every edit → IndexedDB write (500 ms debounce) — survives reloads and
//      offline periods on this device.
//   2. Debounced PUT to the server (2.5 s idle) — single in-flight request
//      with a dirty-flag loop; changes made mid-flight trigger a re-save.
//   3. Retry on window "online", visibility change, and a 30 s backoff timer.
//   4. Immediate flush (IDB + keepalive PUT) when the page is hidden — iOS
//      freezes the tab the moment the phone locks or the crew lead switches
//      apps, which would otherwise strand edits made inside the debounce
//      window until the page is next opened.
//
// Conflicts: PUTs carry baseUpdatedAt; a 409 surfaces as status "conflict"
// and the caller chooses keepMine() (overwrite) or loadTheirs() (discard).
// A 409 without serverUpdatedAt means the log itself refuses edits (already
// submitted/approved, or an approved-week OT lock) — surfaced as "locked"
// with the server's message; the draft stays dirty so the retry heartbeat
// syncs it automatically once the office returns the day to draft.

export type EntryDraft = {
  id: string;
  personnelId: string;
  trade: string | null;
  jobAreaId: string | null;
  workArea: string | null;
  startMinutes: number | null;
  endMinutes: number | null;
  breakMinutes: number;
  costCodeId: string | null;
  phase: string | null;
  budgetLineId: string | null;
  isAbsent: boolean;
  isLate: boolean;
  leftEarly: boolean;
  absenceReason: string | null;
  notes: string | null;
};

export type ServerEntry = EntryDraft & {
  totalHours: number;
  regularHours: number;
  otHours: number;
  totalCost?: number;
  personnel?: { id: string; firstName: string; lastName: string; trade: string | null };
};

export type ServerLog = {
  id: string;
  jobId: string;
  logDate: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
  returnNote: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  updatedAt: string;
  entries: ServerEntry[];
  totals: {
    workersOnsite: number;
    totalHours: number;
    regularHours: number;
    otHours: number;
    totalCost?: number;
  };
};

export type SaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "local" // saved on device, server unreachable
  | "conflict"
  | "locked" // log refuses edits (submitted/approved); draft kept on device
  | "error";

const IDB_DEBOUNCE_MS = 500;
const SYNC_DEBOUNCE_MS = 2500;
const RETRY_MS = 30_000;

export function useLaborSheet(jobId: string, date: string) {
  const qc = useQueryClient();
  const [entries, setEntries] = useState<EntryDraft[] | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [conflictAt, setConflictAt] = useState<string | null>(null);
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);

  const baseUpdatedAt = useRef<string | null>(null);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const entriesRef = useRef<EntryDraft[] | null>(null);
  const idbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const logQuery = useQuery<ServerLog | null>({
    queryKey: ["daily-log", jobId, date],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/daily-logs/${date}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load log");
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  // Hydrate: prefer a dirty local draft newer than the server copy.
  useEffect(() => {
    if (logQuery.isLoading || entries !== null) return;
    let cancelled = false;
    (async () => {
      requestPersistence();
      const server = logQuery.data ?? null;
      const local = await loadLaborDraft<EntryDraft[]>(jobId, date);
      if (cancelled) return;

      const serverTime = server ? new Date(server.updatedAt).getTime() : 0;
      if (local?.dirty && local.savedLocalAt > serverTime) {
        baseUpdatedAt.current = server?.updatedAt ?? null;
        dirty.current = true;
        setEntries(local.entries);
        setStatus("local");
        scheduleSync();
      } else {
        baseUpdatedAt.current = server?.updatedAt ?? null;
        setEntries(server ? server.entries.map(stripServerFields) : []);
        setStatus(server ? "saved" : "idle");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logQuery.isLoading, logQuery.data]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const persistLocal = useCallback(() => {
    if (idbTimer.current) clearTimeout(idbTimer.current);
    idbTimer.current = setTimeout(() => {
      const current = entriesRef.current;
      if (!current) return;
      saveLaborDraft(jobId, date, {
        entries: current,
        baseUpdatedAt: baseUpdatedAt.current,
        savedLocalAt: Date.now(),
        dirty: dirty.current,
      });
    }, IDB_DEBOUNCE_MS);
  }, [jobId, date]);

  const syncNow = useCallback(async (): Promise<boolean> => {
    const current = entriesRef.current;
    if (!current || inFlight.current) return false;
    inFlight.current = true;
    setStatus("saving");
    try {
      let res: Response;
      for (let attempt = 0; ; attempt++) {
        res = await fetch(`/api/jobs/${jobId}/daily-logs/${date}/labor`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // keepalive lets the request survive the page being frozen or torn
          // down mid-flight (phone locked, app switched).
          keepalive: true,
          body: JSON.stringify({
            entries: current,
            ...(baseUpdatedAt.current ? { baseUpdatedAt: baseUpdatedAt.current } : {}),
          }),
        });
        if (res.status !== 409) break;
        const body = await res.json().catch(() => ({}));
        if (!body.serverUpdatedAt) {
          // Status lock (submitted/approved) or approved-week OT lock: keep
          // the draft dirty; the retry heartbeat re-syncs once unlocked.
          setLockedMessage(body.error ?? "This day can no longer be edited");
          setStatus("locked");
          return false;
        }
        // Token conflict — but submit/approve/return/reopen and narrative
        // saves bump updatedAt without touching the crew. If the server's
        // entries still match what we last synced, retake the token and
        // resave; only a real crew difference needs the conflict dialog.
        const base = qc.getQueryData<ServerLog | null>(["daily-log", jobId, date]);
        const fresh: ServerLog | null =
          attempt === 0 && base
            ? await fetch(`/api/jobs/${jobId}/daily-logs/${date}`)
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null)
            : null;
        if (fresh && sameEntries(fresh.entries, base!.entries)) {
          baseUpdatedAt.current = fresh.updatedAt;
          continue;
        }
        setConflictAt(body.serverUpdatedAt);
        setStatus("conflict");
        return false;
      }
      if (!res.ok) {
        setStatus("error");
        return false;
      }
      const saved: ServerLog = await res.json();
      baseUpdatedAt.current = saved.updatedAt;
      setLockedMessage(null);
      // Only clear dirty if nothing changed while the request was in flight.
      if (entriesRef.current === current) {
        dirty.current = false;
        setStatus("saved");
        saveLaborDraft(jobId, date, {
          entries: current,
          baseUpdatedAt: saved.updatedAt,
          savedLocalAt: Date.now(),
          dirty: false,
        });
      }
      qc.setQueryData(["daily-log", jobId, date], saved);
      return true;
    } catch {
      // Network failure — the IDB copy is the safety net.
      setStatus("local");
      return false;
    } finally {
      inFlight.current = false;
      if (dirty.current && entriesRef.current !== current) scheduleSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, date]);

  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      if (dirty.current) void syncNow();
    }, SYNC_DEBOUNCE_MS);
  }, [syncNow]);

  const update = useCallback(
    (mutator: (prev: EntryDraft[]) => EntryDraft[]) => {
      setEntries((prev) => {
        if (!prev) return prev;
        const next = mutator(prev);
        entriesRef.current = next;
        return next;
      });
      dirty.current = true;
      persistLocal();
      scheduleSync();
    },
    [persistLocal, scheduleSync],
  );

  // Retry paths: back online, tab becomes visible, slow heartbeat.
  // Flush path: page hidden (phone locked / app switched) — persist the
  // draft and fire the PUT now instead of waiting out the debounce; iOS
  // may never run the pending timers.
  useEffect(() => {
    const retry = () => {
      if (dirty.current && !inFlight.current) void syncNow();
    };
    const flushHidden = () => {
      if (idbTimer.current) clearTimeout(idbTimer.current);
      const current = entriesRef.current;
      if (current) {
        saveLaborDraft(jobId, date, {
          entries: current,
          baseUpdatedAt: baseUpdatedAt.current,
          savedLocalAt: Date.now(),
          dirty: dirty.current,
        });
      }
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
    retryTimer.current = setInterval(retry, RETRY_MS);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("pagehide", flushHidden);
      document.removeEventListener("visibilitychange", onVisibility);
      if (retryTimer.current) clearInterval(retryTimer.current);
      if (idbTimer.current) clearTimeout(idbTimer.current);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [syncNow, jobId, date]);

  /** Await a final flush (used before submit). Returns true when clean. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    if (!dirty.current) return true;
    return syncNow();
  }, [syncNow]);

  const keepMine = useCallback(async () => {
    baseUpdatedAt.current = null; // overwrite: drop the concurrency token once
    setConflictAt(null);
    await syncNow();
  }, [syncNow]);

  const loadTheirs = useCallback(async () => {
    setConflictAt(null);
    dirty.current = false;
    await clearLaborDraft(jobId, date);
    const fresh = await qc.fetchQuery<ServerLog | null>({
      queryKey: ["daily-log", jobId, date],
      queryFn: async () => {
        const res = await fetch(`/api/jobs/${jobId}/daily-logs/${date}`);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("Failed to load log");
        return res.json();
      },
    });
    baseUpdatedAt.current = fresh?.updatedAt ?? null;
    setEntries(fresh ? fresh.entries.map(stripServerFields) : []);
    setStatus(fresh ? "saved" : "idle");
  }, [jobId, date, qc]);

  const reloadFromServer = useCallback(async () => {
    dirty.current = false;
    await clearLaborDraft(jobId, date);
    await qc.invalidateQueries({ queryKey: ["daily-log", jobId, date] });
    setEntries(null); // re-hydrate from the fresh query
    setStatus("idle");
  }, [jobId, date, qc]);

  return {
    log: logQuery.data ?? null,
    isLoading: logQuery.isLoading || entries === null,
    entries: entries ?? [],
    update,
    status,
    conflictAt,
    lockedMessage,
    flush,
    keepMine,
    loadTheirs,
    reloadFromServer,
  };
}

/** True when two entry lists carry the same draft-visible content. */
function sameEntries(
  a: (ServerEntry | EntryDraft)[],
  b: (ServerEntry | EntryDraft)[],
): boolean {
  if (a.length !== b.length) return false;
  const norm = (list: (ServerEntry | EntryDraft)[]) =>
    JSON.stringify(
      [...list]
        .map((e) => stripServerFields(e as ServerEntry))
        .sort((x, y) => x.id.localeCompare(y.id)),
    );
  return norm(a) === norm(b);
}

function stripServerFields(e: ServerEntry): EntryDraft {
  return {
    id: e.id,
    personnelId: e.personnelId,
    trade: e.trade,
    jobAreaId: e.jobAreaId,
    workArea: e.workArea,
    startMinutes: e.startMinutes,
    endMinutes: e.endMinutes,
    breakMinutes: e.breakMinutes,
    costCodeId: e.costCodeId,
    phase: e.phase,
    budgetLineId: e.budgetLineId,
    isAbsent: e.isAbsent,
    isLate: e.isLate,
    leftEarly: e.leftEarly,
    absenceReason: e.absenceReason,
    notes: e.notes,
  };
}
