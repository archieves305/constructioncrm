import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { isIsoDate } from "@/lib/labor/dates";
import { sendWeeklyPayrollEmail } from "@/lib/labor/payroll-email";
import { logger } from "@/lib/logger";

// Manual "email weekly hours to the bookkeeper" — the Field Mode button.
// (The Friday cron sends the same email automatically; this stays as the
// on-demand path.) Recipient is fixed server-side; see payroll-email.ts.
const TRIGGER_ROLES = new Set(["ADMIN", "MANAGER", "OFFICE_STAFF", "CREW_LEAD"]);

const bodySchema = z.object({
  weekStart: z.string().refine(isIsoDate, "expected YYYY-MM-DD"),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!TRIGGER_ROLES.has(session.user.role)) return forbidden();

  const v = await validateBody(request, bodySchema);
  if (!v.ok) return v.response;

  try {
    const result = await sendWeeklyPayrollEmail({
      weekStart: v.data.weekStart,
      triggeredByUserId: session.user.id,
      triggeredByLabel: `${session.user.firstName} ${session.user.lastName} (Field Mode)`,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err) {
    logger.exception(err, { where: "field-labor.email-weekly" });
    return NextResponse.json(
      { error: "Email failed to send — try again or contact the office" },
      { status: 502 },
    );
  }
}
