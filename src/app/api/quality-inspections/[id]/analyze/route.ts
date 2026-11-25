import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { requestAnalysis, runDue } from "@/lib/inspector/analyze";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { InspectorError, scopeFor } from "@/lib/inspector/service";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ areaId: z.string().max(40).nullish(), mode: z.enum(["closer", "retry"]) });

/** Look again at an area: "closer" with the more capable model, or "retry" a batch that failed. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  try {
    const { rights } = await scopeFor(g.viewer, id);
    if (!rights.canReview && !(rights.canAddPhotos && rights.canSeeProposed)) throw new InspectorError(403, "You cannot ask for another look.");
    const body = schema.parse(await request.json());
    const queued = await requestAnalysis(id, body.areaId ?? null, body.mode, g.viewer.id);
    if (!queued) throw new InspectorError(409, body.mode === "retry" ? "Nothing failed in this area" : "This area has no photos yet");
    after(() => runDue({ inspectionId: id, limit: 4 }));
    return NextResponse.json({ queued }, { status: 202 });
  } catch (err) {
    return inspectorFailure(err, "POST /api/quality-inspections/[id]/analyze");
  }
}
