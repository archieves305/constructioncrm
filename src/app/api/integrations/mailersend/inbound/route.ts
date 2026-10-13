import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { inboundMessageOf, verifyInboundSignature } from "@/lib/integrations/mailersend/inbound";
import { logger } from "@/lib/logger";
import { ingestItbEmail } from "@/lib/partners/itb-intake";

/**
 * MailerSend inbound route → the bid-intake queue. Public (no session) and
 * signed: 503 when the secret is not set (operator), 401 for a bad signature.
 * Every accepted message answers 200 — ignored and duplicate included — so
 * MailerSend never retries something the CRM already holds.
 */
export async function POST(request: NextRequest) {
  const secret = env.MAILERSEND_INBOUND_SECRET;
  if (!secret) return NextResponse.json({ error: "Inbound email is not configured" }, { status: 503 });
  const raw = await request.text();
  const verdict = verifyInboundSignature(raw, request.headers.get("signature"), secret);
  if (verdict === "invalid") return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body is not JSON" }, { status: 400 });
  }
  const message = inboundMessageOf(payload);
  // The validation ping (or any payload that carries no message) is acknowledged and dropped.
  if (verdict === "test" || !message) return NextResponse.json({ ok: true, stored: false });
  try {
    const r = await ingestItbEmail({ channel: "mailersend", externalId: `mailersend:${message.id}`, from: message.from, fromName: message.fromName, subject: message.subject, text: message.text, html: message.html, receivedAt: message.receivedAt });
    logger.info("partners.itb.inbound", { status: r.status, intakeId: r.intakeId });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    logger.exception(err, { where: "integrations.mailersend.inbound" });
    return NextResponse.json({ error: "Could not store the email" }, { status: 500 });
  }
}
