import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canActOnLeadNurture } from "@/lib/nurture/access";
import { onPersonalTouch, setNurtureStatus } from "@/lib/nurture/hooks";
import { cadenceOf, loadNurtureSettings } from "@/lib/nurture/settings";
import { leadNurtureActionSchema } from "@/lib/validators/nurture";

/** GET — this lead's cadence state, last sends, and what is coming next. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const [state, sends, content, settings] = await Promise.all([
    prisma.leadNurtureState.findUnique({ where: { leadId: id } }),
    prisma.leadNurtureSend.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, kind: true, status: true, subject: true, sentAt: true, createdAt: true, error: true } }),
    prisma.nurtureContent.findMany({ where: { isActive: true }, orderBy: [{ step: "asc" }, { sortOrder: "asc" }], select: { id: true, kind: true, step: true, subject: true } }),
    loadNurtureSettings(),
  ]);
  const s = cadenceOf(settings);
  let nextFollowUpSubject: string | null = null;
  let nextNurtureSubject: string | null = null;
  if (state) {
    const fus = content.filter((c) => c.kind === "FOLLOW_UP" && c.step != null).sort((a, b) => a.step! - b.step!);
    nextFollowUpSubject = (fus.find((c) => c.step === state.followUpStep + 1) ?? fus.at(-1))?.subject ?? null;
    const sentIds = new Set((await prisma.leadNurtureSend.findMany({ where: { leadId: id, kind: "NURTURE", status: "SENT" }, select: { contentId: true } })).map((r) => r.contentId));
    nextNurtureSubject = content.find((c) => c.kind === "NURTURE" && !sentIds.has(c.id))?.subject ?? null;
  }
  return NextResponse.json({ state, sends, nextFollowUpSubject, nextNurtureSubject, enabled: settings.enabled, timeZone: s.timeZone });
}

/** POST — pause / resume / stop / enrol, or log a personal touch. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canActOnLeadNurture(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, leadNurtureActionSchema);
  if (!v.ok) return v.response;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (v.data.action === "touch") {
    const now = new Date();
    const type = v.data.communicationType ?? "CALL";
    const note = v.data.note?.trim() || `${type === "CALL" ? "Call" : type === "SMS" ? "Text" : "Email"} with the customer`;
    await prisma.$transaction([
      prisma.communication.create({ data: { leadId: id, communicationType: type, direction: "OUTBOUND", fromValue: "CRM User", toValue: "Lead", body: note, status: "SENT", sentAt: now, createdByUserId: session.user.id } }),
      prisma.activityLog.create({ data: { leadId: id, activityType: type === "CALL" ? "CALL_LOGGED" : type === "SMS" ? "SMS_LOGGED" : "EMAIL_LOGGED", title: `${type} logged`, description: note, createdByUserId: session.user.id } }),
      prisma.lead.update({ where: { id }, data: { lastContactAt: now } }),
    ]);
    await onPersonalTouch(id, now, "manual");
    return NextResponse.json({ ok: true, state: await prisma.leadNurtureState.findUnique({ where: { leadId: id } }) });
  }

  const state = await setNurtureStatus(id, v.data.action, session.user.id);
  if (!state) return NextResponse.json({ error: v.data.action === "enrol" ? "This lead cannot be enrolled (no email, opted out, or closed)" : "This lead is not enrolled" }, { status: 409 });
  return NextResponse.json({ ok: true, state });
}
