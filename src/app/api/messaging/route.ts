import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { TwilioSmsProvider } from "@/lib/services/notifications/twilio-provider";
import { logInboundCommunication } from "@/lib/communications/log";

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

function twimlResponse(status = 200): NextResponse {
  return new NextResponse(TWIML_EMPTY, {
    status,
    headers: { "Content-Type": "application/xml" },
  });
}

// Twilio signs requests by concatenating the full URL with the sorted form
// params (key + value, no separator) and HMAC-SHA1 with the Auth Token as key,
// base64-encoded. https://www.twilio.com/docs/usage/webhooks/webhooks-security
function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(data, "utf-8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf-8"),
      Buffer.from(expected, "utf-8"),
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!env.TWILIO_AUTH_TOKEN) {
    logger.error("inbound SMS webhook hit but TWILIO_AUTH_TOKEN is unset");
    return new NextResponse("Twilio not configured", { status: 503 });
  }

  const signature = request.headers.get("x-twilio-signature");
  if (!signature) {
    return new NextResponse("missing X-Twilio-Signature", { status: 401 });
  }

  const rawText = await request.text();
  const formParams = new URLSearchParams(rawText);
  const payload: Record<string, string> = {};
  formParams.forEach((v, k) => {
    payload[k] = v;
  });

  // Reconstruct the URL Twilio used to compute the signature. Behind a TLS
  // terminator the proto/host headers are authoritative; fall back to the
  // request's own URL only for direct hits.
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const path = new URL(request.url).pathname;
  const fullUrl = `${proto}://${host}${path}`;

  if (!verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, signature, fullUrl, payload)) {
    logger.warn("invalid Twilio signature on inbound SMS", { url: fullUrl });
    return new NextResponse("invalid signature", { status: 403 });
  }

  const provider = new TwilioSmsProvider();
  const inbound = provider.parseInboundWebhook(payload);

  // Match lead by last-10-digit phone suffix to tolerate formatting drift
  // (Twilio sends E.164 like +15551234567; CRM may store "(555) 123-4567").
  const fromDigits = inbound.from.replace(/\D/g, "").slice(-10);
  if (fromDigits.length < 10) {
    logger.warn("inbound SMS with non-matchable From number", {
      from: inbound.from,
    });
    return twimlResponse();
  }

  const matches = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM leads
    WHERE RIGHT(REGEXP_REPLACE(primary_phone, '\D', '', 'g'), 10) = ${fromDigits}
       OR RIGHT(REGEXP_REPLACE(COALESCE(secondary_phone, ''), '\D', '', 'g'), 10) = ${fromDigits}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (matches.length === 0) {
    logger.warn("inbound SMS did not match any lead", {
      from: inbound.from,
      externalId: inbound.externalId,
    });
    return twimlResponse();
  }

  await logInboundCommunication({
    leadId: matches[0].id,
    channel: "SMS",
    provider: "twilio",
    from: inbound.from,
    to: inbound.to,
    body: inbound.body,
    externalMessageId: inbound.externalId,
    receivedAt: inbound.receivedAt,
  });

  return twimlResponse();
}
