import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardInspector, inspectorFailure } from "@/lib/inspector/route";
import { reviewFinding } from "@/lib/inspector/service";
import { DISMISS_REASONS } from "@/lib/inspector/state";

type Ctx = { params: Promise<{ id: string }> };
const box = z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() });
const schema = z.object({
  op: z.enum(["confirm", "dismiss", "reopen", "resolve", "unresolve", "edit"]),
  title: z.string().max(200).optional(),
  evidence: z.string().max(4000).optional(),
  action: z.string().max(2000).nullish(),
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR", "COSMETIC"]).optional(),
  boxes: z.array(box).max(6).optional(),
  dismissReason: z.enum(DISMISS_REASONS).optional(),
  note: z.string().max(2000).nullish(),
});

/** A person's decision on a finding: confirm (with edits), dismiss with a reason, reopen, mark fixed. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const g = await guardInspector();
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  try {
    await reviewFinding(g.viewer, id, schema.parse(await request.json()));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return inspectorFailure(err, "PATCH /api/quality-findings/[id]");
  }
}
