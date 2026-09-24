import { after } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Run best-effort work (email, mostly) after the response has gone out.
 *
 * `after()` is the right tool inside a request — the task write commits, the
 * caller gets its 201, and a slow mail provider never holds anyone up. It
 * throws when there is no request scope (a script, a test), so the fallback
 * just runs the work now and logs any failure instead of surfacing it.
 */
export function runAfterResponse(
  fn: () => Promise<void>,
  ctx: Record<string, unknown> = {},
): void {
  try {
    after(fn);
  } catch {
    void fn().catch((err) => logger.exception(err, { where: "runAfterResponse", ...ctx }));
  }
}
