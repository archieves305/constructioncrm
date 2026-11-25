import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withIdempotency } from "@/lib/api/idempotency";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { addArea } from "@/lib/inspector/service";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ id: z.string().max(40).optional(), name: z.string().min(1).max(80), trade: z.string().max(40).nullish() });

/** Add a room or area (an existing one of the same name is returned instead). */
export async function POST(request: NextRequest, ctx: Ctx) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  return withIdempotency(request, g.viewer.id, `POST /api/quality-inspections/${id}/areas`, async () => {
    try {
      return NextResponse.json(await addArea(g.viewer, id, schema.parse(await request.json())), { status: 201 });
    } catch (err) {
      return inspectorFailure(err, "POST /api/quality-inspections/[id]/areas");
    }
  });
}
