export interface InboundEmail {
  externalMessageId: string;
  senderEmail: string;
  subject: string;
  receivedAt: Date;
  bodyText: string;
  bodyHtml: string;
}

export interface EmailInboxProvider {
  name: string;
  fetchUnreadLeadEmails(): Promise<InboundEmail[]>;
  getMessageById(messageId: string): Promise<InboundEmail | null>;
  markProcessed(messageId: string): Promise<void>;
  moveToFolder(messageId: string, folderName: string): Promise<void>;
}
