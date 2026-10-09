import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardPlanSet } from "@/lib/takeoff/route-guards";
import { listSheets } from "@/lib/takeoff/service";

/** Every sheet of the set in document order, with the index in force and what code detected. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardPlanSet(session.user, id, "read");
  if (denied) return denied;
  return NextResponse.json(await listSheets(id));
}
