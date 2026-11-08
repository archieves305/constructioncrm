import * as Sentry from "@sentry/react-native";
import { APP_VERSION } from "@/config";
import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";

/**
 * Crash reporting. Off unless the build carries a Sentry key
 * (EXPO_PUBLIC_SENTRY_DSN, set per build profile in eas.json): development
 * and Expo Go never report. Reports are scrubbed (sentry-scrub.ts) and name
 * the person by CRM user id only. No performance tracing, no session replay.
 */
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
export const sentryOn = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENV ?? "production",
    release: `knu-field@${APP_VERSION}`,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    // The scrub functions take Sentry's shapes loosely (they are tested without Sentry).
    beforeSend: (event) => scrubEvent(event as never) as typeof event,
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb as never) as typeof crumb | null,
  });
}

/** Called on sign-in and sign-out: the CRM user id, nothing else. */
export function setCrashUser(id: string | null) {
  if (sentryOn) Sentry.setUser(id ? { id } : null);
}

/** Wraps the root so a render crash is reported (a no-op wrapper when off). */
export function wrapRoot(c: () => React.JSX.Element): () => React.JSX.Element {
  return sentryOn ? (Sentry.wrap(c as React.ComponentType<Record<string, unknown>>) as unknown as () => React.JSX.Element) : c;
}
