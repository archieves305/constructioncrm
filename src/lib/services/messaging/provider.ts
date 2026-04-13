export interface SendMessageParams {
  to: string;
  from: string;
  body: string;
  leadId?: string;
}

export interface MessageStatusResult {
  externalId: string;
  status: "pending" | "sent" | "delivered" | "failed";
}

export interface InboundMessage {
  externalId: string;
  from: string;
  to: string;
  body: string;
  receivedAt: Date;
}

export interface MessagingProvider {
  sendMessage(params: SendMessageParams): Promise<MessageStatusResult>;
  getMessageStatus(externalId: string): Promise<MessageStatusResult>;
  parseInboundWebhook(payload: unknown): InboundMessage;
}
