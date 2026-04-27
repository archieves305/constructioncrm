import { Resend } from "resend";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

type SendEmailArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

export async function sendEmail(args: SendEmailArgs): Promise<{ id: string } | null> {
  const c = getClient();
  if (!c || !env.EMAIL_FROM) {
    logger.warn("email send skipped: Resend not configured", { subject: args.subject });
    return null;
  }

  const { data, error } = await c.emails.send({
    from: env.EMAIL_FROM,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    replyTo: args.replyTo,
    headers: args.headers,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
  return data ? { id: data.id } : null;
}

export function isEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}
