import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { ingestItbEmail, listIntakes } from "@/lib/partners/itb-intake";
import { unwrapForward } from "@/lib/partners/itb-parse";
import { INTAKE_STATUSES, intakePasteSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** The bid-intake queue: emailed invitations waiting for a person, and what became of the rest. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const s = request.nextUrl.searchParams.get("status") ?? "NEW";
  const status = (INTAKE_STATUSES as readonly string[]).includes(s) ? (s as (typeof INTAKE_STATUSES)[number]) : "NEW";
  return NextResponse.json(await listIntakes(status));
}

/** A pasted email: read it like a forwarded one and put it in the queue. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, intakePasteSchema);
  if (!v.ok) return v.response;
  const body = v.data.body.replace(/\r\n?/g, "\n");
  const un = unwrapForward(body);
  const subject = v.data.subject || un.subject || body.split("\n").find((l) => l.trim())?.slice(0, 200) || "(pasted email)";
  // The same paste twice is the same item.
  const externalId = `manual:${createHash("sha256").update(`${subject}\n${body}`).digest("hex").slice(0, 40)}`;
  try {
    const r = await ingestItbEmail({ channel: "manual", externalId, from: v.data.from || session.user.email || "manual@local", subject, text: body, receivedAt: new Date(), submittedByUserId: session.user.id });
    return NextResponse.json(r, { status: r.status === "queued" ? 201 : 200 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
