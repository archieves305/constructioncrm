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

// ── Photo upload queue ──────────────────────────────────────────────────────
// Pending (downscaled) photo blobs awaiting upload, persisted so a dead spot
// or app close never loses a picture. Drained sequentially by the photo
// section; each item uploads with its client id so retries skip-if-exists.

export type QueuedPhoto = {
  id: string; // client-generated, doubles as the server id
  jobId: string;
  date: string;
  dailyLogId: string | null;
  blob: Blob;
  fileName: string;
  category: string;
  caption: string | null;
  areaText: string | null;
  createdAt: number;
  attempts: number;
};

const photoKey = (id: string) => `photo:${id}`;
const PHOTO_INDEX_KEY = "photo-queue-index";

async function getPhotoIndex(): Promise<string[]> {
  if (!store) return [];
  try {
    return (await get(PHOTO_INDEX_KEY, store)) ?? [];
  } catch {
    return [];
  }
}

export async function enqueuePhoto(photo: QueuedPhoto): Promise<void> {
  if (!store) return;
  try {
    await set(photoKey(photo.id), photo, store);
    const index = await getPhotoIndex();
    if (!index.includes(photo.id)) {
      await set(PHOTO_INDEX_KEY, [...index, photo.id], store);
    }
  } catch {
    /* storage unavailable — upload proceeds from memory only */
  }
}

export async function dequeuePhoto(id: string): Promise<void> {
  if (!store) return;
  try {
    await del(photoKey(id), store);
    const index = await getPhotoIndex();
    await set(
      PHOTO_INDEX_KEY,
      index.filter((x) => x !== id),
      store,
    );
  } catch {
    /* ignore */
  }
}

export async function listQueuedPhotos(
  jobId: string,
  date: string,
): Promise<QueuedPhoto[]> {
  if (!store) return [];
  try {
    const index = await getPhotoIndex();
    const out: QueuedPhoto[] = [];
    for (const id of index) {
      const item = (await get(photoKey(id), store)) as QueuedPhoto | undefined;
      if (item && item.jobId === jobId && item.date === date) out.push(item);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}
