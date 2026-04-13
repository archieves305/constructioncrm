import type {
  MessagingProvider,
  SendMessageParams,
  MessageStatusResult,
  InboundMessage,
} from "./provider";

export class TwilioMessagingProvider implements MessagingProvider {
  async sendMessage(_params: SendMessageParams): Promise<MessageStatusResult> {
    // TODO: Implement with Twilio SDK
    throw new Error("Twilio messaging not yet configured. Enable in Phase 2.");
  }

  async getMessageStatus(_externalId: string): Promise<MessageStatusResult> {
    throw new Error("Twilio messaging not yet configured. Enable in Phase 2.");
  }

  parseInboundWebhook(_payload: unknown): InboundMessage {
    throw new Error("Twilio inbound webhook not yet configured. Enable in Phase 2.");
  }
}
