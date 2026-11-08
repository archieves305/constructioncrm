import * as SQLite from "expo-sqlite";

/**
 * Text being typed that has not been saved yet (a daily log's write-up), kept
 * on the phone so closing the app or losing the screen does not lose it.
 * Cleared once the person saves. Sign-out clears everything (clearAllDrafts).
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync("knu-field-drafts.db");
    await d.execAsync("CREATE TABLE IF NOT EXISTS drafts (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, savedAt INTEGER NOT NULL)");
    return d;
  })();
  return dbPromise;
}

export async function readDraft<T>(key: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ value: string }>("SELECT value FROM drafts WHERE key = ?", key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function writeDraft(key: string, value: unknown): Promise<void> {
  await (await db()).runAsync(
    "INSERT INTO drafts (key, value, savedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, savedAt = excluded.savedAt",
    key, JSON.stringify(value), Date.now(),
  );
}

export async function clearDraft(key: string): Promise<void> {
  await (await db()).runAsync("DELETE FROM drafts WHERE key = ?", key);
}

export async function clearAllDrafts(): Promise<void> {
  await (await db()).runAsync("DELETE FROM drafts");
}
