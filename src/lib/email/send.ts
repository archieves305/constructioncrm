import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";
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

let client: MailerSend | null = null;

function getClient(): MailerSend | null {
  if (!env.MAILERSEND_API_KEY) return null;
  if (!client) client = new MailerSend({ apiKey: env.MAILERSEND_API_KEY });
  return client;
}

/**
 * Parse `EMAIL_FROM` into a MailerSend `Sender`. Accepts either:
 *   - plain "addr@example.com"
 *   - RFC-5322 "Display Name <addr@example.com>"
 */
function parseFromAddress(raw: string): Sender {
  const m = raw.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (m) return new Sender(m[2].trim(), m[1].trim());
  return new Sender(raw.trim());
}

function toRecipients(to: string | string[]): Recipient[] {
  return (Array.isArray(to) ? to : [to]).map((addr) => new Recipient(addr));
}

export async function sendEmail(args: SendEmailArgs): Promise<{ id: string } | null> {
  const c = getClient();
  if (!c || !env.EMAIL_FROM) {
    logger.warn("email send skipped: MailerSend not configured", { subject: args.subject });
    return null;
  }

  const params = new EmailParams()
    .setFrom(parseFromAddress(env.EMAIL_FROM))
    .setTo(toRecipients(args.to))
    .setSubject(args.subject)
    .setHtml(args.html);

  if (args.text) params.setText(args.text);
  if (args.replyTo) params.setReplyTo(new Recipient(args.replyTo));

  if (args.headers) {
    const remaining: { name: string; value: string }[] = [];
    for (const [name, value] of Object.entries(args.headers)) {
      // MailerSend has a first-class field for the List-Unsubscribe value;
      // anything else falls through to the generic `headers` array.
      if (name.toLowerCase() === "list-unsubscribe") {
        params.setListUnsubscribe(value);
      } else {
        remaining.push({ name, value });
      }
    }
    if (remaining.length) params.setHeaders(remaining);
  }

  const response = await c.email.send(params);

  if (response.statusCode >= 400) {
    const detail =
      typeof response.body === "string"
        ? response.body
        : JSON.stringify(response.body);
    throw new Error(`MailerSend error (${response.statusCode}): ${detail}`);
  }

  // MailerSend returns the message ID via the x-message-id response header.
  const headers = response.headers as Record<string, string | string[]> | undefined;
  const rawId = headers?.["x-message-id"] ?? headers?.["X-Message-Id"];
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  return id ? { id } : null;
}

export function isEmailConfigured(): boolean {
  return Boolean(env.MAILERSEND_API_KEY && env.EMAIL_FROM);
}
