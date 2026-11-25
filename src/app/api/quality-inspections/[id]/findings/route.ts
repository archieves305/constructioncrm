import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withIdempotency } from "@/lib/api/idempotency";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { addFinding } from "@/lib/inspector/service";

type Ctx = { params: Promise<{ id: string }> };
const box = z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() });
const schema = z.object({
  areaId: z.string().max(40).nullish(),
  photoId: z.string().max(40).nullish(),
  title: z.string().trim().min(1).max(200),
  evidence: z.string().max(4000).optional(),
  action: z.string().max(2000).nullish(),
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR", "COSMETIC"]),
  kind: z.enum(["OBSERVED", "SUSPECTED", "DOCUMENTATION", "SCOPE", "PHYSICAL_CHECK", "CANNOT_DETERMINE"]).optional(),
  trade: z.string().max(40).nullish(),
  boxes: z.array(box).max(6).optional(),
});

/** A finding a person adds (the AI missed it). */
export async function POST(request: NextRequest, ctx: Ctx) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  return withIdempotency(request, g.viewer.id, `POST /api/quality-inspections/${id}/findings`, async () => {
    try {
      return NextResponse.json(await addFinding(g.viewer, id, schema.parse(await request.json())), { status: 201 });
    } catch (err) {
      return inspectorFailure(err, "POST /api/quality-inspections/[id]/findings");
    }
  });
}
