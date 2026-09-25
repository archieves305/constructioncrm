import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { listCategories } from "@/lib/violations/categories";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "1";
  return NextResponse.json(await listCategories({ includeInactive }));
}
