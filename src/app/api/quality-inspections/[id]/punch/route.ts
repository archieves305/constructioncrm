import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withIdempotency } from "@/lib/api/idempotency";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { raisePunchItems } from "@/lib/inspector/service";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ findingIds: z.array(z.string().max(40)).max(200).optional() });

/** Confirmed findings without one become punch items (field issue PUNCH + task), one each. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  return withIdempotency(request, g.viewer.id, `POST /api/quality-inspections/${id}/punch`, async () => {
    try {
      const body = schema.parse(await request.json().catch(() => ({})));
      return NextResponse.json(await raisePunchItems(g.viewer, id, body.findingIds));
    } catch (err) {
      return inspectorFailure(err, "POST /api/quality-inspections/[id]/punch");
    }
  });
}
