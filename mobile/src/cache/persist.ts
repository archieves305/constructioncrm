import * as SQLite from "expo-sqlite";
import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import { keepQueries, shouldPersist } from "./rules";

/**
 * The phone's saved copy of what the CRM last sent: one row per signed-in
 * person, in the app's own storage (encrypted by iOS with the phone's
 * passcode), deleted at sign-out. Restored before the screens open, so a
 * phone without signal shows what it last had instead of a spinner.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
/** Bumped at sign-out: a save started before it is dropped, never written back. */
let generation = 0;
function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync("knu-field-cache.db");
    await d.execAsync("CREATE TABLE IF NOT EXISTS cache (userId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL, savedAt INTEGER NOT NULL)");
    return d;
  })();
  return dbPromise;
}

export async function restoreSavedCopy(qc: QueryClient, userId: string): Promise<number> {
  const row = await (await db()).getFirstAsync<{ state: string }>("SELECT state FROM cache WHERE userId = ?", userId);
  if (!row) return 0;
  let parsed: ReturnType<typeof dehydrate>;
  try {
    parsed = JSON.parse(row.state);
  } catch {
    return 0;
  }
  const queries = keepQueries(parsed.queries ?? [], Date.now());
  hydrate(qc, { mutations: [], queries });
  return queries.length;
}

export async function writeSavedCopy(qc: QueryClient, userId: string): Promise<void> {
  const started = generation;
  const state = dehydrate(qc, { shouldDehydrateQuery: (x) => x.state.status === "success" && shouldPersist(x.queryKey) });
  const d = await db();
  if (started !== generation) return;
  await d.runAsync(
    "INSERT INTO cache (userId, state, savedAt) VALUES (?, ?, ?) ON CONFLICT(userId) DO UPDATE SET state = excluded.state, savedAt = excluded.savedAt",
    userId, JSON.stringify(state), Date.now(),
  );
}

/** Sign-out: nothing of the CRM stays on the phone. */
export async function clearSavedCopy(): Promise<void> {
  generation += 1;
  await (await db()).runAsync("DELETE FROM cache");
}
