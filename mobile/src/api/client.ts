import type { z } from "zod";
import { APP_VERSION, CRM_URL } from "@/config";
import { readToken } from "@/auth/storage";

/**
 * The one way the app calls the CRM. Every request carries the session token
 * as a Bearer header and the app version. A refusal comes back as an ApiError
 * with the server's own sentence, which the screens show as it is.
 *
 * The CRM answers a request it cannot identify with a redirect to the portal
 * login page (an HTML page), not a 401; both are treated as "signed out".
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** The server's whole error body (a conflict carries the current record). */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get signedOut(): boolean {
    return this.status === 401;
  }
  get offline(): boolean {
    return this.status === 0;
  }
}

let onSignedOut: (() => void) | null = null;
/** The session provider registers what to do when the CRM refuses the token. */
export function setSignedOutHandler(fn: (() => void) | null): void {
  onSignedOut = fn;
}

type Options<S extends z.ZodTypeAny | undefined> = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  schema?: S;
  /** Use this token instead of the stored one (during sign-in). */
  token?: string;
  /** Sent as Idempotency-Key, so a resend is answered without a second write. */
  idempotencyKey?: string;
  timeoutMs?: number;
};

export async function api<S extends z.ZodTypeAny | undefined = undefined>(
  path: string,
  opts: Options<S> = {},
): Promise<S extends z.ZodTypeAny ? z.infer<S> : unknown> {
  const token = opts.token ?? (await readToken());
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-App-Version": APP_VERSION,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${CRM_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError("No connection to the CRM", 0, "offline");
  } finally {
    clearTimeout(timer);
  }

  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (res.status === 401 || (res.redirected && !isJson)) {
    onSignedOut?.();
    throw new ApiError("Signed out. Please sign in again.", 401, "signed_out");
  }
  if (res.status === 204) return undefined as never;

  const data: unknown = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const body = (data ?? {}) as { error?: unknown; code?: unknown };
    const message =
      typeof body.error === "string"
        ? body.error
        : res.status === 403
          ? "You don't have access to this"
          : res.status === 404
            ? "Not found, or not available to you"
            : `The CRM answered ${res.status}`;
    throw new ApiError(message, res.status, typeof body.code === "string" ? body.code : undefined, data);
  }
  if (!isJson) throw new ApiError("Unexpected answer from the CRM", res.status, "not_json");
  if (opts.schema) {
    const parsed = opts.schema.safeParse(data);
    if (!parsed.success) throw new ApiError("The CRM's answer didn't match this app version", res.status, "contract");
    return parsed.data as never;
  }
  return data as never;
}
