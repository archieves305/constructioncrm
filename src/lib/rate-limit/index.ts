import { NextRequest, NextResponse } from "next/server";

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
};

type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();

let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, b] of store) {
    if (b.resetAt <= now) store.delete(k);
  }
}

export function rateLimit({ key, limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweep(now);
  let bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    store.set(key, bucket);
  }
  bucket.count++;
  const ok = bucket.count <= limit;
  const remaining = Math.max(0, limit - bucket.count);
  return { ok, remaining, resetAt: bucket.resetAt };
}

export function clientIp(req: Request | NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

export type EnforceRateLimitOptions = {
  name: string;
  limit: number;
  windowMs: number;
  identifier?: string;
};

export function enforceRateLimit(
  req: NextRequest | Request,
  opts: EnforceRateLimitOptions,
): NextResponse | null {
  const ident = opts.identifier ?? clientIp(req);
  const key = `${opts.name}:${ident}`;
  const result = rateLimit({ key, limit: opts.limit, windowMs: opts.windowMs });
  if (result.ok) return null;
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(opts.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    },
  );
}

export function __resetRateLimitForTests(): void {
  store.clear();
  lastSweep = 0;
}
