import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import {
  generateChangeOrderAddendumPdf,
  MissingFieldsError,
  NotFoundError,
} from "@/lib/contracts/generate";
import { logger } from "@/lib/logger";

const bodySchema = z
  .object({
    laborContractId: z.string().nullable().optional(),
    contractDocumentVersionId: z.string().nullable().optional(),
  })
  .nullable();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const co = await prisma.laborChangeOrder.findUnique({
    where: { id },
    select: { laborContract: { select: { id: true, jobId: true } } },
  });
  if (!co)
    return NextResponse.json(
      { error: "Change order not found" },
      { status: 404 },
    );

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  const opts = parsed.success ? parsed.data : null;

  try {
    const doc = await generateChangeOrderAddendumPdf(
      co.laborContract.jobId,
      id,
      session.user.id,
      opts?.laborContractId ?? co.laborContract.id,
      opts?.contractDocumentVersionId ?? null,
    );
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
    logger.exception(e, { route: "generate-addendum", changeOrderId: id });
    return NextResponse.json(
      { error: "Failed to generate addendum" },
      { status: 500 },
    );
  }
}
