import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withIdempotency } from "@/lib/api/idempotency";
import { INSPECTION_KINDS, QUALITY_PROFILES } from "@/lib/inspector/catalog";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { createInspection, listInspections, readInspection } from "@/lib/inspector/service";

/**
 * AI Field Inspector: list the quality inspections the viewer may see, or
 * start one. (Permit inspections are /api/inspections — a different record.)
 */
export async function GET(request: NextRequest) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const q = request.nextUrl.searchParams;
  const status = q.get("status");
  try {
    const rows = await listInspections(g.viewer, {
      jobId: q.get("jobId"),
      status: status === "OPEN" || status === "ACCEPTED" || status === "CLOSED" ? status : null,
      mine: q.get("mine") === "1",
      take: Number(q.get("take")) || undefined,
    });
    return NextResponse.json({ inspections: rows });
  } catch (err) {
    return inspectorFailure(err, "GET /api/quality-inspections");
  }
}

const createSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(INSPECTION_KINDS),
  jobId: z.string().max(40).nullish(),
  laborContractId: z.string().max(40).nullish(),
  addressText: z.string().max(300).nullish(),
  title: z.string().max(200).nullish(),
  scopeText: z.string().max(8000).nullish(),
  qualityProfile: z.enum(QUALITY_PROFILES).nullish(),
  areas: z.array(z.object({ name: z.string().max(80), trade: z.string().max(40).nullish() })).max(40).optional(),
});

export async function POST(request: NextRequest) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  // the phone may send a queued start twice; the key (and the phone-made id) keep it one inspection
  return withIdempotency(request, g.viewer.id, "POST /api/quality-inspections", async () => {
    try {
      const input = createSchema.parse(await request.json());
      const { id, created } = await createInspection(g.viewer, input);
      return NextResponse.json(await readInspection(g.viewer, id), { status: created ? 201 : 200 });
    } catch (err) {
      return inspectorFailure(err, "POST /api/quality-inspections");
    }
  });
}
