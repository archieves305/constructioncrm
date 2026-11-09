import { createHash, randomBytes } from "node:crypto";

/**
 * Guest-link codes. The code (32 random bytes, 43 characters) goes in the link
 * and is shown once; only its SHA-256 is stored, so a copy of the database
 * cannot open a link.
 */
export function newGuestToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashGuestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A code in the shape newGuestToken makes; anything else is not looked up. */
export function looksLikeGuestToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
