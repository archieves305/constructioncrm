import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { preferencesSchema } from "@/lib/validators/preferences";

/**
 * Per-user preferences: notification switches plus what the lists and
 * boards open on.
 *
 * Task mail is internal work assignment rather than marketing, so it carries
 * no unsubscribe link — but it still needs a way off, or the first noisy week
 * teaches people to build a mail-client filter. A filter is invisible to us
 * and swallows the urgent assignment along with the noise; this toggle is at
 * least visible in the product and reversible by an admin conversation.
 */
const PREF_SELECT = {
  taskEmailsEnabled: true,
  escalationEmailsEnabled: true,
  reminderDigestEnabled: true,
  nudgeEmailsEnabled: true,
  defaultListScope: true,
  boardDensity: true,
} as const;

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: PREF_SELECT,
  });

  return NextResponse.json(
    {
      taskEmailsEnabled: user?.taskEmailsEnabled ?? true,
      escalationEmailsEnabled: user?.escalationEmailsEnabled ?? true,
      reminderDigestEnabled: user?.reminderDigestEnabled ?? true,
      nudgeEmailsEnabled: user?.nudgeEmailsEnabled ?? true,
      defaultListScope: user?.defaultListScope ?? "MINE",
      boardDensity: user?.boardDensity ?? "COMFORTABLE",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const parsed = await validateBody(request, preferencesSchema);
  if (!parsed.ok) return parsed.response;

  // Field by field, never a spread: an absent key means "leave alone".
  const d = parsed.data;
  const data: Prisma.UserUpdateInput = {};
  if (d.taskEmailsEnabled !== undefined) data.taskEmailsEnabled = d.taskEmailsEnabled;
  if (d.escalationEmailsEnabled !== undefined) data.escalationEmailsEnabled = d.escalationEmailsEnabled;
  if (d.reminderDigestEnabled !== undefined) data.reminderDigestEnabled = d.reminderDigestEnabled;
  if (d.nudgeEmailsEnabled !== undefined) data.nudgeEmailsEnabled = d.nudgeEmailsEnabled;
  if (d.defaultListScope !== undefined) data.defaultListScope = d.defaultListScope;
  if (d.boardDensity !== undefined) data.boardDensity = d.boardDensity;

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: PREF_SELECT,
  });

  return NextResponse.json(updated);
}
