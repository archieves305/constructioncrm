import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { listPermitTypes } from "@/lib/permit-intel/service";

/** The permit-type catalog (seeded by prisma/seed-permit-intel.ts). */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  return NextResponse.json(await listPermitTypes());
}
