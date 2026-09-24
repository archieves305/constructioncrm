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
  escalationEmailsEnabled: z.boolean().optional(),
  reminderDigestEnabled: z.boolean().optional(),
  nudgeEmailsEnabled: z.boolean().optional(),
});

const PREF_SELECT = {
  taskEmailsEnabled: true,
  escalationEmailsEnabled: true,
  reminderDigestEnabled: true,
  nudgeEmailsEnabled: true,
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
  const data: Record<string, boolean> = {};
  if (d.taskEmailsEnabled !== undefined) data.taskEmailsEnabled = d.taskEmailsEnabled;
  if (d.escalationEmailsEnabled !== undefined) data.escalationEmailsEnabled = d.escalationEmailsEnabled;
  if (d.reminderDigestEnabled !== undefined) data.reminderDigestEnabled = d.reminderDigestEnabled;
  if (d.nudgeEmailsEnabled !== undefined) data.nudgeEmailsEnabled = d.nudgeEmailsEnabled;

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: PREF_SELECT,
  });

  return NextResponse.json(updated);
}
