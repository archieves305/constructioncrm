import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { findPossibleDuplicates } from "@/lib/integrations/buildium/checks";
import {
  BuildiumError,
  BuildiumNotConfiguredError,
  isBuildiumConfigured,
} from "@/lib/integrations/buildium/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const { searchParams } = request.nextUrl;
  const bankAccountId = Number(searchParams.get("bankAccountId"));
  const vendorIdParam = Number(searchParams.get("vendorId"));
  if (!bankAccountId) {
    return NextResponse.json(
      { error: "bankAccountId is required" },
      { status: 400 },
    );
  }

  if (!isBuildiumConfigured()) {
    return NextResponse.json(
      { error: "Buildium is not configured." },
      { status: 503 },
    );
  }

  const expense = await prisma.jobExpense.findUnique({
    where: { id },
    select: {
      amount: true,
      incurredDate: true,
      job: { select: { buildiumPropertyId: true } },
    },
  });
  if (!expense) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }
  if (!expense.job.buildiumPropertyId) {
    return NextResponse.json({ matches: [] });
  }

  try {
    const matches = await findPossibleDuplicates({
      bankAccountId,
      incurredDate: expense.incurredDate,
      amount: Number(expense.amount),
      buildiumPropertyId: expense.job.buildiumPropertyId,
      vendorId: vendorIdParam || undefined,
    });
    return NextResponse.json({ matches });
  } catch (e) {
    if (e instanceof BuildiumNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    if (e instanceof BuildiumError) {
      return NextResponse.json(
        { error: e.message, buildiumStatus: e.status },
        { status: 502 },
      );
    }
    const message = e instanceof Error ? e.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
