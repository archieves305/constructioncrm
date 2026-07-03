import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string }> };

// Who automatically receives the approved daily report PDF for this job.
// Office-managed; every change is audited (these addresses get jobsite data).
const MANAGE_ROLES = new Set(["ADMIN", "MANAGER", "OFFICE_STAFF"]);

const putSchema = z.object({
  recipients: z.array(z.string().trim().email()).max(10),
});

export async function GET(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!MANAGE_ROLES.has(session.user.role)) return forbidden();

  const { id } = await context.params;
  const job = await prisma.job.findUnique({
    where: { id },
    select: { dailyReportRecipients: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ recipients: job.dailyReportRecipients });
}

export async function PUT(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!MANAGE_ROLES.has(session.user.role)) return forbidden();

  const { id } = await context.params;
  const v = await validateBody(request, putSchema);
  if (!v.ok) return v.response;

  const existing = await prisma.job.findUnique({
    where: { id },
    select: { dailyReportRecipients: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const recipients = [...new Set(v.data.recipients.map((r) => r.toLowerCase()))];
  const updated = await prisma.job.update({
    where: { id },
    data: { dailyReportRecipients: recipients },
    select: { dailyReportRecipients: true },
  });

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "Job",
    entityId: id,
    action: "report_recipients_change",
    before: { recipients: existing.dailyReportRecipients },
    after: { recipients },
  });

  return NextResponse.json({ recipients: updated.dailyReportRecipients });
}
