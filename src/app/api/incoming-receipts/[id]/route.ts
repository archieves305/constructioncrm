import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { linkReceiptToJob, unlinkReceipt } from "@/lib/receipts/link-to-job";

const updateSchema = z.object({
  action: z.enum(["match", "unmatch", "dismiss", "restore", "delete"]),
  jobId: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  switch (parsed.data.action) {
    case "match":
      if (!parsed.data.jobId) return badRequest("jobId is required for match");
      await linkReceiptToJob(id, parsed.data.jobId, session.user.id);
      break;
    case "unmatch":
      await unlinkReceipt(id);
      break;
    case "dismiss":
      await prisma.incomingReceipt.update({
        where: { id },
        data: { status: "DISMISSED" },
      });
      break;
    case "restore":
      await prisma.incomingReceipt.update({
        where: { id },
        data: { status: "UNMATCHED" },
      });
      break;
    case "delete":
      await unlinkReceipt(id);
      await prisma.incomingReceipt.delete({ where: { id } });
      return NextResponse.json({ ok: true });
  }

  const record = await prisma.incomingReceipt.findUnique({ where: { id } });
  return NextResponse.json(record);
}
