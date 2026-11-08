import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

/**
 * Safe retries for writes the phone app queues while offline
 * (CAREYOS_MOBILE_APP_PLAN.md §F.2). The app sends `Idempotency-Key: <uuid>`
 * on each write; the first response to that key is kept for 7 days, and the
 * same key from the same person on the same route gets it back instead of a
 * second write. No header: the route behaves exactly as before.
 *
 *   - a key still being worked on answers 409 `in_progress` (retry shortly);
 *   - a key reused for a different route answers 422;
 *   - a 5xx or a thrown error is not kept, so the retry runs again.
 */

const KEY = /^[A-Za-z0-9._:-]{8,100}$/;
const KEEP_DAYS = 7;

export function readIdempotencyKey(header: string | null): { key: string | null; valid: boolean } {
  if (header === null || header === "") return { key: null, valid: true };
  return KEY.test(header) ? { key: header, valid: true } : { key: null, valid: false };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function withIdempotency(
  req: Request,
  userId: string,
  route: string,
  run: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const { key, valid } = readIdempotencyKey(req.headers.get("idempotency-key"));
  if (!valid) {
    return NextResponse.json(
      { error: "Idempotency-Key must be 8–100 letters, digits or . _ : -", code: "bad_idempotency_key" },
      { status: 400 },
    );
  }
  if (!key) return run();

  let claimId: string;
  try {
    const claim = await prisma.apiIdempotency.create({ data: { userId, key, route }, select: { id: true } });
    claimId = claim.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const prior = await prisma.apiIdempotency.findUnique({ where: { userId_key: { userId, key } } });
    if (!prior) return run(); // pruned in between; treat as new
    if (prior.route !== route) {
      return NextResponse.json(
        { error: "This Idempotency-Key was already used for a different request", code: "idempotency_key_reused" },
        { status: 422 },
      );
    }
    if (prior.statusCode === null) {
      return NextResponse.json(
        { error: "The first copy of this request is still running", code: "in_progress" },
        { status: 409, headers: { "Retry-After": "2" } },
      );
    }
    return prior.statusCode === 204
      ? new NextResponse(null, { status: 204, headers: { "Idempotent-Replay": "true" } })
      : NextResponse.json(prior.responseJson ?? null, {
          status: prior.statusCode,
          headers: { "Idempotent-Replay": "true" },
        });
  }

  let res: NextResponse;
  try {
    res = await run();
  } catch (err) {
    await prisma.apiIdempotency.delete({ where: { id: claimId } }).catch(() => undefined);
    throw err;
  }

  if (res.status >= 500) {
    await prisma.apiIdempotency.delete({ where: { id: claimId } }).catch(() => undefined);
    return res;
  }
  let body: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
  if (res.status !== 204 && (res.headers.get("content-type") ?? "").includes("application/json")) {
    body = ((await res.clone().json().catch(() => null)) ?? Prisma.JsonNull) as Prisma.InputJsonValue;
  }
  await prisma.apiIdempotency
    .update({ where: { id: claimId }, data: { statusCode: res.status, responseJson: body } })
    .catch((e) => logger.warn("idempotency: could not keep the response", { route, error: String(e) }));

  // Now and then, forget keys older than a week.
  if (Math.random() < 0.02) {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000);
    void prisma.apiIdempotency.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => undefined);
  }
  return res;
}
