import type { EmailInboxProvider, InboundEmail } from "./email-provider";
import { env, assertProviderEnv } from "@/lib/env";

// Uses Microsoft Graph client-credentials flow (app-only). Requires Mail.Read,
// Mail.ReadWrite application permissions on the tenant.
export class OutlookInboxProvider implements EmailInboxProvider {
  name = "outlook_graph";

  private async getAccessToken(): Promise<string> {
    assertProviderEnv("Outlook (intake)");
    const tenantId = env.OUTLOOK_TENANT_ID!;
    const clientId = env.OUTLOOK_CLIENT_ID!;
    const clientSecret = env.OUTLOOK_CLIENT_SECRET!;

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to get Graph token: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return data.access_token;
  }

  private get mailbox(): string {
    return env.OUTLOOK_MAILBOX_ADDRESS!;
  }

  private async graphFetch(path: string, options?: RequestInit): Promise<Response> {
    const token = await this.getAccessToken();
    return fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  }

  async fetchUnreadLeadEmails(): Promise<InboundEmail[]> {
    const res = await this.graphFetch(
      `/users/${this.mailbox}/mailFolders/Inbox/messages?$filter=isRead eq false&$top=50&$select=id,from,subject,receivedDateTime,body,bodyPreview&$orderby=receivedDateTime desc`
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch emails: ${res.status}`);
    }

    const data = await res.json();

    return (data.value || []).map((msg: Record<string, unknown>) => ({
      externalMessageId: msg.id as string,
      senderEmail: (msg.from as { emailAddress: { address: string } })?.emailAddress?.address || "",
      subject: msg.subject as string,
      receivedAt: new Date(msg.receivedDateTime as string),
      bodyText: (msg.body as { content: string })?.content || msg.bodyPreview as string || "",
      bodyHtml: (msg.body as { contentType: string; content: string })?.contentType === "html"
        ? (msg.body as { content: string }).content
        : "",
    }));
  }

  async getMessageById(messageId: string): Promise<InboundEmail | null> {
    const res = await this.graphFetch(
      `/users/${this.mailbox}/messages/${messageId}?$select=id,from,subject,receivedDateTime,body`
    );

    if (!res.ok) return null;

    const msg = await res.json();
    return {
      externalMessageId: msg.id,
      senderEmail: msg.from?.emailAddress?.address || "",
      subject: msg.subject,
      receivedAt: new Date(msg.receivedDateTime),
      bodyText: msg.body?.content || "",
      bodyHtml: msg.body?.contentType === "html" ? msg.body.content : "",
    };
  }

  async markProcessed(messageId: string): Promise<void> {
    await this.graphFetch(`/users/${this.mailbox}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ isRead: true }),
    });
  }

  async moveToFolder(messageId: string, folderName: string): Promise<void> {
    // Find or create folder
    const foldersRes = await this.graphFetch(
      `/users/${this.mailbox}/mailFolders?$filter=displayName eq '${folderName}'`
    );
    const foldersData = await foldersRes.json();

    let folderId: string;
    if (foldersData.value?.length > 0) {
      folderId = foldersData.value[0].id;
    } else {
      const createRes = await this.graphFetch(`/users/${this.mailbox}/mailFolders`, {
        method: "POST",
        body: JSON.stringify({ displayName: folderName }),
      });
      const created = await createRes.json();
      folderId = created.id;
    }

    await this.graphFetch(`/users/${this.mailbox}/messages/${messageId}/move`, {
      method: "POST",
      body: JSON.stringify({ destinationId: folderId }),
    });
  }
}
