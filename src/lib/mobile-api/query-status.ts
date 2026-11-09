/**
 * Which of the four screens a query should show. Client-safe and pure so the
 * choice is tested once and every page agrees: a refusal is never "no data",
 * a missing record is never "loading", and a server fault offers a retry.
 */
export type QueryStatus = "loading" | "forbidden" | "not_found" | "failed" | "ready";

export interface QueryLike {
  isPending?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  data?: unknown;
}

/** The HTTP status carried by an `HttpError` (or anything shaped like one). */
export function errorStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const s = (error as { status: unknown }).status;
    if (typeof s === "number") return s;
  }
  return null;
}

export function queryStatus(q: QueryLike): QueryStatus {
  if (q.isError || q.error) {
    const s = errorStatus(q.error);
    if (s === 401 || s === 403) return "forbidden";
    if (s === 404 || s === 410) return "not_found";
    return "failed";
  }
  if (q.data === undefined) return "loading";
  return "ready";
}
