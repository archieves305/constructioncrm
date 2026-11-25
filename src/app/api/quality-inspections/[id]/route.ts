import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { INSPECTION_KINDS, QUALITY_PROFILES } from "@/lib/inspector/catalog";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { readInspection, updateInspection } from "@/lib/inspector/service";

type Ctx = { params: Promise<{ id: string }> };

/** One inspection: areas, photos, findings (a crew sees only confirmed ones), blockers, rights. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await readInspection(g.viewer, id));
  } catch (err) {
    return inspectorFailure(err, "GET /api/quality-inspections/[id]");
  }
}

const patchSchema = z.object({
  title: z.string().max(200).nullish(),
  kind: z.enum(INSPECTION_KINDS).optional(),
  jobId: z.string().max(40).nullish(),
  laborContractId: z.string().max(40).nullish(),
  addressText: z.string().max(300).nullish(),
  scopeText: z.string().max(8000).nullish(),
  qualityProfile: z.enum(QUALITY_PROFILES).optional(),
  close: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  try {
    await updateInspection(g.viewer, id, patchSchema.parse(await request.json()));
    return NextResponse.json(await readInspection(g.viewer, id));
  } catch (err) {
    return inspectorFailure(err, "PATCH /api/quality-inspections/[id]");
  }
}
