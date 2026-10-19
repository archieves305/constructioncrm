import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { decideLesson } from "@/lib/permit-intel/knowledge";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

const decisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "RETIRED", "PROPOSED"]).optional(),
  title: z.string().trim().min(3, "Give the lesson a title").max(200).optional(),
  body: z.string().trim().max(4000).nullable().optional(),
  check: z.object({ requiresDocType: z.string().max(60) }).nullable().optional(),
  jurisdictionId: z.string().max(60).nullable().optional(),
  permitTypeKey: z.string().max(60).nullable().optional(),
});

/** Approve, reject or retire a lesson; edit its wording, where it applies and its check. */
export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, decisionSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await decideLesson(id, v.data, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}
