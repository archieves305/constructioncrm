// Shared between the NextAuth authorize callback (server) and the login page
// (client). Keep this module free of server-only state so it can be bundled
// client-side.

const LOCKED_ERROR_PREFIX = "AccountLocked:";

/**
 * Error thrown from `authorize` when the account is locked out. NextAuth
 * surfaces the message as `result.error` on `signIn(..., { redirect: false })`.
 */
export function lockedError(lockedUntilMs: number): Error {
  return new Error(`${LOCKED_ERROR_PREFIX}${lockedUntilMs}`);
}

/** Returns the lockout expiry (epoch ms) if the signIn error is a lockout, else null. */
export function parseLockedError(message: string | undefined | null): number | null {
  if (!message?.startsWith(LOCKED_ERROR_PREFIX)) return null;
  const until = Number(message.slice(LOCKED_ERROR_PREFIX.length));
  return Number.isFinite(until) ? until : null;
}
