import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import {
  generateLaborContractPdf,
  MissingFieldsError,
  NotFoundError,
} from "@/lib/contracts/generate";
import { logger } from "@/lib/logger";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const lc = await prisma.laborContract.findUnique({
    where: { id },
    select: { jobId: true },
  });
  if (!lc)
    return NextResponse.json(
      { error: "Labor contract not found" },
      { status: 404 },
    );

  try {
    const doc = await generateLaborContractPdf(lc.jobId, id, session.user.id);
    return NextResponse.json(doc, { status: 201 });
  } catch (e) {
    if (e instanceof MissingFieldsError) {
      return NextResponse.json(
        { error: "Missing required fields", missingFields: e.fields },
        { status: 422 },
      );
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    logger.exception(e, { route: "generate-contract", laborContractId: id });
    return NextResponse.json(
      { error: "Failed to generate contract" },
      { status: 500 },
    );
  }
}
