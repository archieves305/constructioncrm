import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { zylowClient } from "@/lib/services/zylow/client";
import { zylowErrorResponse } from "@/lib/services/zylow/http";
import { compsQuerySchema } from "@/lib/validators/zylow";

// Comparable sales for a property. Passthrough to Zylow (not cached locally
// yet — comps churn and aren't needed offline). 404 if the property isn't
// cached upstream; 200 with comps:[] if it's cached but has no comps run.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const parsed = compsQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  try {
    const comps = await zylowClient.getComps(id, parsed.data.limit);
    if (!comps) {
      return NextResponse.json(
        { error: "We don't have this property" },
        { status: 404 },
      );
    }
    return NextResponse.json(comps);
  } catch (err) {
    return zylowErrorResponse(err, { route: "zylow/comps", reapiId: id });
  }
}
