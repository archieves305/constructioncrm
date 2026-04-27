const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60_000;
const LOCKOUT_DURATION_MS = 15 * 60_000;

type Entry = {
  count: number;
  firstFailureAt: number;
  lockedUntil: number;
};

const failures = new Map<string, Entry>();

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export function isLockedOut(email: string): { locked: boolean; until: number } {
  const key = normalize(email);
  const entry = failures.get(key);
  if (!entry) return { locked: false, until: 0 };
  const now = Date.now();
  if (entry.lockedUntil > now) {
    return { locked: true, until: entry.lockedUntil };
  }
  if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
    failures.delete(key);
  }
  return { locked: false, until: 0 };
}

export function recordLoginFailure(email: string): { locked: boolean; until: number } {
  const key = normalize(email);
  const now = Date.now();
  let entry = failures.get(key);

  if (!entry || now - entry.firstFailureAt > LOCKOUT_WINDOW_MS) {
    entry = { count: 0, firstFailureAt: now, lockedUntil: 0 };
  }

  entry.count++;

  if (entry.count >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
  }

  failures.set(key, entry);

  return entry.lockedUntil > now
    ? { locked: true, until: entry.lockedUntil }
    : { locked: false, until: 0 };
}

export function clearLoginFailures(email: string): void {
  failures.delete(normalize(email));
}

export function __resetLockoutForTests(): void {
  failures.clear();
}

export const LOCKOUT = {
  threshold: LOCKOUT_THRESHOLD,
  windowMs: LOCKOUT_WINDOW_MS,
  durationMs: LOCKOUT_DURATION_MS,
};
