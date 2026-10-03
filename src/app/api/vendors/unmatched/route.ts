import { NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canViewVendors } from "@/lib/vendors/access";
import { getUnmatched } from "@/lib/vendors/service";

/** Payee spellings, crews and typed contractors that have no vendor record yet. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewVendors(session.user.role)) return forbidden();
  return NextResponse.json(await getUnmatched());
}
