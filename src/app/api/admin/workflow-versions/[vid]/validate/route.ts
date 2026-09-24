import { NextRequest, NextResponse } from "next/server";
import { templateActor } from "@/lib/workflows/admin-route";
import { validateVersion } from "@/lib/workflows/validate";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const a = await templateActor("view");
  if ("response" in a) return a.response;
  const { vid } = await params;
  return NextResponse.json(await validateVersion(vid));
}
