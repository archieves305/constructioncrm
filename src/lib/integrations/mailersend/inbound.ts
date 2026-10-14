import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * MailerSend inbound routing: the route forwards each received email as JSON
 * to our URL, signed in the `Signature` header with a lowercase hex
 * HMAC-SHA256 of the raw body, keyed with the route's secret. The validation
 * ping MailerSend sends when the route is saved is signed with its published
 * test secret and carries no message.
 */

export const MAILERSEND_TEST_SECRET = "test_Am3L1GuOIc4blLUuHqAPxxwkZaJyEk8G";

function hmac(secret: string, raw: string): string {
  return createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type SignatureVerdict = "valid" | "test" | "invalid";

export function verifyInboundSignature(raw: string, signature: string | null, secret: string): SignatureVerdict {
  const sig = (signature ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sig)) return "invalid";
  if (same(sig, hmac(secret, raw))) return "valid";
  if (same(sig, hmac(MAILERSEND_TEST_SECRET, raw))) return "test";
  return "invalid";
}

export type InboundMessage = { id: string; from: string; fromName: string | null; subject: string; text: string | null; html: string | null; receivedAt: Date };

/** The message inside an `inbound.message` payload, or null when the payload is anything else. */
export function inboundMessageOf(payload: unknown): InboundMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const d = (p.data ?? null) as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  const from = (d.from ?? {}) as Record<string, unknown>;
  const sender = (d.sender ?? {}) as Record<string, unknown>;
  const email = typeof from.email === "string" ? from.email : typeof sender.email === "string" ? sender.email : null;
  const id = typeof d.id === "string" ? d.id : null;
  if (!email || !id) return null;
  const when = typeof d.date === "string" ? new Date(d.date) : typeof d.created_at === "string" ? new Date(d.created_at) : new Date();
  return {
    id,
    from: email,
    fromName: typeof from.name === "string" && from.name.trim() ? from.name.trim() : null,
    subject: typeof d.subject === "string" ? d.subject : "",
    text: typeof d.text === "string" ? d.text : null,
    html: typeof d.html === "string" ? d.html : null,
    receivedAt: Number.isNaN(when.getTime()) ? new Date() : when,
  };
}
