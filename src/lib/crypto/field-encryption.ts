import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// Field-level encryption for sensitive personnel data (SSNs).
//
// AES-256-GCM with a versioned keyring so keys can rotate without downtime:
// FIELD_ENCRYPTION_KEYS="v1:<base64 32-byte key>,v2:<...>". The highest
// version encrypts new writes; decryption picks the key named by the
// ciphertext's version prefix. Wire format: "v{n}:{iv}:{tag}:{ct}" (base64
// segments), self-describing so rows encrypted under old keys stay readable
// until a rotation sweep re-encrypts them.
//
// AAD binds a ciphertext to its owning row (e.g. "personnel:<id>") so a
// ciphertext copied into another row fails authentication instead of
// decrypting to someone else's SSN.

const IV_BYTES = 12;
const KEY_BYTES = 32;

export type Keyring = {
  activeVersion: number;
  keys: Map<number, Buffer>;
};

export function parseKeyring(raw: string): Keyring {
  const keys = new Map<number, Buffer>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const match = /^v(\d+):(.+)$/.exec(trimmed);
    if (!match) {
      throw new Error(
        `FIELD_ENCRYPTION_KEYS entry must look like "v1:<base64 key>", got "${trimmed.slice(0, 8)}…"`,
      );
    }
    const version = Number(match[1]);
    const key = Buffer.from(match[2], "base64");
    if (key.byteLength !== KEY_BYTES) {
      throw new Error(
        `FIELD_ENCRYPTION_KEYS v${version} must decode to ${KEY_BYTES} bytes, got ${key.byteLength}`,
      );
    }
    if (keys.has(version)) {
      throw new Error(`FIELD_ENCRYPTION_KEYS has duplicate version v${version}`);
    }
    keys.set(version, key);
  }
  if (keys.size === 0) {
    throw new Error("FIELD_ENCRYPTION_KEYS contains no keys");
  }
  return { activeVersion: Math.max(...keys.keys()), keys };
}

export function encryptWithKeyring(
  ring: Keyring,
  plaintext: string,
  aad: string,
): { ciphertext: string; keyVersion: number } {
  const key = ring.keys.get(ring.activeVersion)!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `v${ring.activeVersion}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`,
    keyVersion: ring.activeVersion,
  };
}

export function decryptWithKeyring(
  ring: Keyring,
  ciphertext: string,
  aad: string,
): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || !/^v\d+$/.test(parts[0])) {
    throw new Error("Malformed field ciphertext");
  }
  const version = Number(parts[0].slice(1));
  const key = ring.keys.get(version);
  if (!key) {
    throw new Error(`No key for ciphertext version v${version}`);
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ── Env-bound wrappers ──────────────────────────────────────────────────────

let cachedKeyring: Keyring | null = null;

export function isFieldEncryptionConfigured(): boolean {
  return Boolean(env.FIELD_ENCRYPTION_KEYS);
}

function envKeyring(): Keyring {
  if (!env.FIELD_ENCRYPTION_KEYS) {
    throw new Error(
      "Field encryption is not configured. Set FIELD_ENCRYPTION_KEYS.",
    );
  }
  cachedKeyring ??= parseKeyring(env.FIELD_ENCRYPTION_KEYS);
  return cachedKeyring;
}

export function encryptField(plaintext: string, aad: string) {
  return encryptWithKeyring(envKeyring(), plaintext, aad);
}

export function decryptField(ciphertext: string, aad: string): string {
  return decryptWithKeyring(envKeyring(), ciphertext, aad);
}

// ── SSN helpers ─────────────────────────────────────────────────────────────

/** Strip formatting and validate a 9-digit SSN; null when input isn't one. */
export function normalizeSsn(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

export function maskSsn(last4: string): string {
  return `•••-••-${last4}`;
}
