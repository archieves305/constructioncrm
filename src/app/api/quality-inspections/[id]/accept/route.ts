import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { acceptInspection, readInspection } from "@/lib/inspector/service";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ override: z.string().max(2000).nullish() });

/** Accept the work. Open items need an ADMIN / MANAGER and a reason; unreviewed findings and running analyses never pass. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  try {
    const body = schema.parse(await request.json().catch(() => ({})));
    await acceptInspection(g.viewer, id, body.override);
    return NextResponse.json(await readInspection(g.viewer, id));
  } catch (err) {
    return inspectorFailure(err, "POST /api/quality-inspections/[id]/accept");
  }
}
