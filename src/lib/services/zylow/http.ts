import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  ZylowAuthError,
  ZylowCreditExhausted,
  ZylowNotConfiguredError,
  ZylowRateLimitError,
  ZylowServerError,
} from "./client";

/**
 * Map a thrown Zylow client error to an HTTP response for our proxy routes.
 * Re-throws anything it doesn't recognize so genuine bugs still surface.
 */
export function zylowErrorResponse(err: unknown, ctx: Record<string, unknown>): NextResponse {
  if (err instanceof ZylowNotConfiguredError) {
    logger.warn("zylow route hit but key unset", ctx);
    return NextResponse.json(
      { error: "Property data is not configured" },
      { status: 503 },
    );
  }
  if (err instanceof ZylowRateLimitError) {
    return NextResponse.json(
      { error: "Property data rate limit reached — try again shortly" },
      { status: 429 },
    );
  }
  if (err instanceof ZylowCreditExhausted) {
    logger.warn("zylow credit ceiling reached", ctx);
    return NextResponse.json(
      { error: "Property-data credit limit reached — cached lookups still work" },
      { status: 402 },
    );
  }
  if (err instanceof ZylowAuthError) {
    logger.exception(err, { ...ctx, where: "zylow" });
    return NextResponse.json(
      { error: "Property data service rejected our credentials" },
      { status: 502 },
    );
  }
  if (err instanceof ZylowServerError) {
    logger.exception(err, { ...ctx, where: "zylow" });
    return NextResponse.json(
      { error: "Property data service is unavailable" },
      { status: 502 },
    );
  }
  throw err;
}
