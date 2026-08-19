/**
 * Client-side JSON fetch that fails loudly.
 *
 * `fetch()` only rejects on a network fault, so `fetch(url).then(r => r.json())`
 * hands back the error *body* of a 404, a 500 or a 401 as though it were data.
 * Callers then have to guess what they are holding, and the guesses have been
 * wrong in expensive ways: a job page that read every error as "Job not found"
 * sent people hunting for a deleted record during a database outage, and list
 * queries that expect an array get an object and crash on `.filter`.
 *
 * Throwing instead gives react-query something to work with — `isError`, the
 * status code, and automatic retries for the failures that are worth retrying.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }

  /** A record that isn't there stays absent no matter how often we ask. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** The server's own `{ error }` message when it sent one, else a generic line. */
async function messageFor(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Non-JSON body (an HTML error page, or nothing at all).
  }
  return `Request failed (${response.status})`;
}

/**
 * `T` defaults to `any` to mirror `Response.json()`, which this replaces
 * verbatim at ~a dozen call sites. Narrowing the default to `unknown` would be
 * the stricter choice but turns a one-line swap into a typing project at every
 * caller; pass an explicit type where the shape is known.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new HttpError(response.status, await messageFor(response));
  }
  return response.json() as Promise<T>;
}

/**
 * react-query `retry` predicate. A 4xx is the caller's fault and will fail
 * identically on the next attempt; a 5xx or a network fault may not, and the
 * connection-exhaustion outages this app actually suffers clear on their own.
 */
export function retryServerErrors(failureCount: number, error: unknown): boolean {
  if (error instanceof HttpError && error.status < 500) return false;
  return failureCount < 2;
}
