import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type {
  NearbyParams,
  ZylowAutocompleteResponse,
  ZylowCompsResponse,
  ZylowNearbyResponse,
  ZylowPropertyRecord,
  ZylowWhoami,
} from "./types";

const USER_AGENT = "knuco-crm-door-knock/1.0";

// ── Error types ──────────────────────────────────────────────────────────────
// Callers distinguish "not configured" (503) and "auth" (502, alert) from the
// ordinary not-found (handled as null/empty) so route handlers can map them to
// the right HTTP status without string-matching messages.
export class ZylowNotConfiguredError extends Error {
  constructor() {
    super("ZYLOW_API_KEY is not set");
    this.name = "ZylowNotConfiguredError";
  }
}

export class ZylowAuthError extends Error {
  constructor(public status: number, detail?: string) {
    super(`Zylow auth failed (${status})${detail ? `: ${detail}` : ""}`);
    this.name = "ZylowAuthError";
  }
}

export class ZylowRateLimitError extends Error {
  constructor() {
    super("Zylow rate limit exceeded");
    this.name = "ZylowRateLimitError";
  }
}

// 402: the token's monthly/lifetime REAPI credit ceiling is reached. Only the
// live REAPI fall-back is blocked — cached lookups (autocomplete, nearby, and
// already-seen properties) keep working.
export class ZylowCreditExhausted extends Error {
  constructor(detail?: string) {
    super(detail || "Zylow REAPI credit ceiling reached");
    this.name = "ZylowCreditExhausted";
  }
}

export class ZylowServerError extends Error {
  constructor(public status: number) {
    super(`Zylow server error (${status})`);
    this.name = "ZylowServerError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isZylowConfigured(): boolean {
  return Boolean(env.ZYLOW_API_KEY);
}

async function readDetail(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { detail?: string };
    return body?.detail;
  } catch {
    return undefined;
  }
}

/**
 * Low-level GET against the Zylow API. Returns the parsed JSON on 200, or
 * `null` on 404 (not cached). Throws the typed errors above for auth / rate
 * limit / persistent 5xx. 5xx is retried with exponential backoff (1s, 2s, 4s).
 */
async function zylowGet<T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T | null> {
  if (!env.ZYLOW_API_KEY) throw new ZylowNotConfiguredError();

  const url = new URL(`${env.ZYLOW_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const maxAttempts = 3;
  let lastServerStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "X-API-Key": env.ZYLOW_API_KEY,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        // Don't let a hung upstream wedge our request handler.
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      // Network/timeout — treat like a 5xx and back off.
      lastServerStatus = 0;
      logger.warn("zylow fetch failed (network)", {
        path,
        attempt,
        err: err instanceof Error ? err.message : String(err),
      });
      if (attempt < maxAttempts) {
        await sleep(2 ** (attempt - 1) * 1000);
        continue;
      }
      throw new ZylowServerError(0);
    }

    if (res.ok) return (await res.json()) as T;
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      throw new ZylowAuthError(res.status, await readDetail(res));
    }
    if (res.status === 402) throw new ZylowCreditExhausted(await readDetail(res));
    if (res.status === 429) throw new ZylowRateLimitError();

    if (res.status >= 500) {
      lastServerStatus = res.status;
      logger.warn("zylow 5xx", { path, status: res.status, attempt });
      if (attempt < maxAttempts) {
        await sleep(2 ** (attempt - 1) * 1000);
        continue;
      }
    } else {
      // Unexpected 4xx — surface it rather than retrying.
      throw new ZylowServerError(res.status);
    }
  }

  throw new ZylowServerError(lastServerStatus);
}

// ── Public API ───────────────────────────────────────────────────────────────

export const zylowClient = {
  /** Token healthcheck. Throws on auth failure; returns metadata on success. */
  whoami(): Promise<ZylowWhoami | null> {
    return zylowGet<ZylowWhoami>("/whoami");
  },

  /**
   * Address typeahead — cache-only, never charges a REAPI credit. Caller should
   * debounce and only fire at 3+ chars; we guard the minimum here too.
   */
  async autocomplete(q: string, limit = 10): Promise<ZylowAutocompleteResponse> {
    const trimmed = q.trim();
    if (trimmed.length < 3) {
      return { q: trimmed, results: [], count: 0, data_source: "zylow-cache" };
    }
    const res = await zylowGet<ZylowAutocompleteResponse>(
      "/property/autocomplete",
      { q: trimmed, limit },
    );
    return res ?? { q: trimmed, results: [], count: 0, data_source: "zylow-cache" };
  },

  /** A single property, or null if Zylow hasn't cached it (404). */
  getProperty(reapiId: string): Promise<ZylowPropertyRecord | null> {
    return zylowGet<ZylowPropertyRecord>(`/property/${encodeURIComponent(reapiId)}`);
  },

  /** Comps for a property. Empty array if the property exists but has no comps. */
  async getComps(reapiId: string, limit = 20): Promise<ZylowCompsResponse | null> {
    return zylowGet<ZylowCompsResponse>(
      `/property/${encodeURIComponent(reapiId)}/comps`,
      { limit },
    );
  },

  /** Cached properties within a GPS radius, closest-first. */
  async getNearby({
    lat,
    lng,
    radiusMiles = 5,
    limit = 100,
  }: NearbyParams): Promise<ZylowNearbyResponse> {
    const res = await zylowGet<ZylowNearbyResponse>("/property/nearby", {
      lat,
      lng,
      radius_miles: radiusMiles,
      limit,
    });
    // nearby returns 200 with empty results rather than 404; null would only
    // happen on an unexpected 404 — normalize to an empty result set.
    return (
      res ?? { results: [], count: 0, lat, lng, radius_miles: radiusMiles, limit }
    );
  },
};
