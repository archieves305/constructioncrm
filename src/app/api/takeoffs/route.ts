import { NextRequest, NextResponse } from "next/server";
import { badRequest, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { guardLeadForTakeoff, guardPlanSet } from "@/lib/takeoff/route-guards";
import { createTakeoff, listTakeoffs } from "@/lib/takeoff/takeoff-service";
import { createTakeoffSchema } from "@/lib/takeoff/validation";

/** The takeoffs on a lead. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const leadId = request.nextUrl.searchParams.get("leadId");
  if (!leadId) return badRequest("leadId is required");
  const denied = await guardLeadForTakeoff(session.user, leadId, "read");
  if (denied) return denied;
  return NextResponse.json(await listTakeoffs(leadId));
}

/** Start a trade's takeoff on a plan set; the sheets code proposes come with it. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const body = await validateBody(request, createTakeoffSchema);
  if (!body.ok) return body.response;
  const denied = await guardPlanSet(session.user, body.data.planSetId, "write");
  if (denied) return denied;
  const created = await createTakeoff({ planSetId: body.data.planSetId, trade: body.data.trade, userId: session.user.id });
  if (!created) return NextResponse.json({ error: "Plan set not found" }, { status: 404 });
  return NextResponse.json(created, { status: 201 });
}
