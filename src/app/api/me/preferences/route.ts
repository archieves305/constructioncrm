import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";

/**
 * Per-user notification preferences.
 *
 * Task mail is internal work assignment rather than marketing, so it carries
 * no unsubscribe link — but it still needs a way off, or the first noisy week
 * teaches people to build a mail-client filter. A filter is invisible to us
 * and swallows the urgent assignment along with the noise; this toggle is at
 * least visible in the product and reversible by an admin conversation.
 */
const preferencesSchema = z.object({
  taskEmailsEnabled: z.boolean().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { taskEmailsEnabled: true },
  });

  return NextResponse.json(
    { taskEmailsEnabled: user?.taskEmailsEnabled ?? true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const parsed = await validateBody(request, preferencesSchema);
  if (!parsed.ok) return parsed.response;

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: { taskEmailsEnabled: parsed.data.taskEmailsEnabled },
    select: { taskEmailsEnabled: true },
  });

  return NextResponse.json(updated);
}
