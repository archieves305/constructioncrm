import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { syncExpenseToBuildium } from "@/lib/integrations/buildium/sync";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const bankAccountId = Number(body.bankAccountId);
  const vendorId = Number(body.vendorId);
  if (!bankAccountId || !vendorId) {
    return NextResponse.json(
      { error: "bankAccountId and vendorId are required" },
      { status: 400 },
    );
  }

  const result = await syncExpenseToBuildium(id, { bankAccountId, vendorId });
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
