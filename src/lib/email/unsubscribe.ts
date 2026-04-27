import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const SEPARATOR = ".";

function sign(data: string): string {
  return createHmac("sha256", env.NEXTAUTH_SECRET)
    .update(data)
    .digest("base64url");
}

export function generateUnsubscribeToken(leadId: string): string {
  const sig = sign(leadId);
  return `${Buffer.from(leadId, "utf8").toString("base64url")}${SEPARATOR}${sig}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const parts = token.split(SEPARATOR);
  if (parts.length !== 2) return null;
  let leadId: string;
  try {
    leadId = Buffer.from(parts[0]!, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = sign(leadId);
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[1]!);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return leadId;
}

export function buildUnsubscribeUrl(leadId: string): string {
  const token = generateUnsubscribeToken(leadId);
  return `${env.NEXTAUTH_URL.replace(/\/$/, "")}/api/email/unsubscribe?token=${token}`;
}
