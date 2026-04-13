import type {
  MessagingProvider,
  SendMessageParams,
  MessageStatusResult,
  InboundMessage,
} from "@/lib/services/messaging/provider";
import { env, assertProviderEnv } from "@/lib/env";

export class TwilioSmsProvider implements MessagingProvider {
  private get accountSid() { return env.TWILIO_ACCOUNT_SID!; }
  private get authToken() { return env.TWILIO_AUTH_TOKEN!; }
  private get fromNumber() { return env.TWILIO_FROM_NUMBER!; }

  async sendMessage(params: SendMessageParams): Promise<MessageStatusResult> {
    assertProviderEnv("Twilio (SMS)");
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    const body = new URLSearchParams({
      To: params.to,
      From: params.from || this.fromNumber,
      Body: params.body,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Twilio send failed: ${res.status} ${errText}`);
    }

    const data = await res.json();

    return {
      externalId: data.sid,
      status: mapTwilioStatus(data.status),
    };
  }

  async getMessageStatus(externalId: string): Promise<MessageStatusResult> {
    assertProviderEnv("Twilio (SMS)");
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages/${externalId}.json`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!res.ok) throw new Error(`Twilio status check failed: ${res.status}`);

    const data = await res.json();
    return {
      externalId: data.sid,
      status: mapTwilioStatus(data.status),
    };
  }

  parseInboundWebhook(payload: unknown): InboundMessage {
    const p = payload as Record<string, string>;
    return {
      externalId: p.MessageSid || p.SmsSid || "",
      from: p.From || "",
      to: p.To || "",
      body: p.Body || "",
      receivedAt: new Date(),
    };
  }
}

function mapTwilioStatus(status: string): "pending" | "sent" | "delivered" | "failed" {
  switch (status) {
    case "queued":
    case "accepted":
      return "pending";
    case "sending":
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "undelivered":
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}
