import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/validation/body";
import { decideChangeOrder } from "@/lib/services/change-orders";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  name: z.string().trim().min(1, "Please type your name").max(200),
  reason: z.string().max(4000).nullable().optional(),
});

// Public, token-gated approve/reject (no login).
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;

  const result = await decideChangeOrder(
    token,
    v.data.decision,
    v.data.name,
    ip,
    v.data.reason,
  );

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "expired"
          ? 410
          : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json(result);
}
