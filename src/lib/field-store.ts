import { createStore, del, get, set } from "idb-keyval";

// Device-local durability layer for field mode. Drafts written here survive
// page reloads, app closes, and offline periods on the same iPad + browser.
// NOT synced across devices — the server copy is the source of truth once a
// save lands. iOS may evict site storage under pressure; requestPersistence()
// reduces (but cannot eliminate) that risk.

const store =
  typeof indexedDB !== "undefined"
    ? createStore("knuco-field", "drafts")
    : null;

export type LaborSheetDraft<TEntries> = {
  entries: TEntries;
  /** Server updatedAt this draft was last synced against (concurrency token). */
  baseUpdatedAt: string | null;
  savedLocalAt: number;
  dirty: boolean;
};

const draftKey = (jobId: string, date: string) => `labor:${jobId}:${date}`;

export async function loadLaborDraft<T>(
  jobId: string,
  date: string,
): Promise<LaborSheetDraft<T> | null> {
  if (!store) return null;
  try {
    return (await get(draftKey(jobId, date), store)) ?? null;
  } catch {
    return null;
  }
}

export async function saveLaborDraft<T>(
  jobId: string,
  date: string,
  draft: LaborSheetDraft<T>,
): Promise<void> {
  if (!store) return;
  try {
    await set(draftKey(jobId, date), draft, store);
  } catch {
    // Storage full/evicted — the server sync path still works.
  }
}

export async function clearLaborDraft(jobId: string, date: string): Promise<void> {
  if (!store) return;
  try {
    await del(draftKey(jobId, date), store);
  } catch {
    /* ignore */
  }
}

let persistenceRequested = false;

/** Ask the browser to protect our storage from eviction (best effort). */
export function requestPersistence(): void {
  if (persistenceRequested || typeof navigator === "undefined") return;
  persistenceRequested = true;
  navigator.storage?.persist?.().catch(() => {});
}
