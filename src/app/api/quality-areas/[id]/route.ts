import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { updateArea } from "@/lib/inspector/service";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ name: z.string().max(80).optional(), trade: z.string().max(40).nullish(), checked: z.boolean().optional() });

/** Rename an area, set its trade, or (a reviewer) mark it checked by a person. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  try {
    await updateArea(g.viewer, id, schema.parse(await request.json()));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return inspectorFailure(err, "PATCH /api/quality-areas/[id]");
  }
}
