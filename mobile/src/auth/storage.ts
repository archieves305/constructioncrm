import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { SessionUserDto } from "@crm/mobile-api";

/**
 * What the app keeps on the phone, all in the Keychain / Keystore, never
 * migrated to another device by a backup.
 *   - the CareyOS session token
 *   - the last signed-in person (so the app opens without signal)
 *   - an installation id, made once; it is how the CRM tells phones apart
 */
const OPTS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const TOKEN = "careyos_session";
const USER = "last_user";
const INSTALLATION = "installation_id";

export async function readToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN, OPTS);
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN, token, OPTS);
}

export async function readCachedUser(): Promise<SessionUserDto | null> {
  const raw = await SecureStore.getItemAsync(USER, OPTS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUserDto;
  } catch {
    return null;
  }
}

export async function saveCachedUser(user: SessionUserDto): Promise<void> {
  await SecureStore.setItemAsync(USER, JSON.stringify(user), OPTS);
}

/** Sign-out and revoke: remove everything that identifies the person. */
export async function wipeSession(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(TOKEN, OPTS), SecureStore.deleteItemAsync(USER, OPTS)]);
}

export async function installationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALLATION, OPTS);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALLATION, id, OPTS);
  return id;
}
