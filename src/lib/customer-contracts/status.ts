// Client-safe presentation for contract status. No Prisma imports.

import type { Tone } from "@/lib/ui/tones";
import type { CustomerContractStatusValue } from "./types";

export const CONTRACT_STATUS_TONE: Record<CustomerContractStatusValue, Tone> = {
  DRAFT: "neutral",
  SENT: "info",
  SIGNED: "success",
  DECLINED: "danger",
  VOID: "neutral",
};

export const CONTRACT_STATUS_LABEL: Record<CustomerContractStatusValue, string> = {
  DRAFT: "Draft",
  SENT: "Awaiting signature",
  SIGNED: "Signed",
  DECLINED: "Declined",
  VOID: "Void",
};

export function isTerminalContractStatus(s: CustomerContractStatusValue): boolean {
  return s === "SIGNED" || s === "DECLINED" || s === "VOID";
}

export type ContractRow = {
  status: CustomerContractStatusValue;
  sentAt: string | null;
  sentToEmail: string | null;
  tokenExpiresAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

const short = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** One line under the contract number: what happened last and when. */
export function contractStatusLine(c: ContractRow, now: Date = new Date()): string {
  switch (c.status) {
    case "DRAFT":
      return "Draft — preview it, then send it to the customer to sign.";
    case "SENT": {
      const expired = c.tokenExpiresAt ? new Date(c.tokenExpiresAt) < now : false;
      const sent = c.sentAt ? `Sent ${short(c.sentAt)}` : "Sent";
      const to = c.sentToEmail ? ` to ${c.sentToEmail}` : "";
      const exp = c.tokenExpiresAt
        ? expired
          ? ` · link expired ${short(c.tokenExpiresAt)} — resend`
          : ` · link expires ${short(c.tokenExpiresAt)}`
        : "";
      return `${sent}${to}${exp}`;
    }
    case "SIGNED":
      return `Signed ${c.signedAt ? short(c.signedAt) : ""}${c.signerName ? ` by ${c.signerName}` : ""}`.trim();
    case "DECLINED":
      return `Declined ${c.declinedAt ? short(c.declinedAt) : ""}${c.declineReason ? `: ${c.declineReason}` : ""}`.trim();
    case "VOID":
      return `Voided ${c.voidedAt ? short(c.voidedAt) : ""}${c.voidReason ? `: ${c.voidReason}` : ""}`.trim();
  }
}

export function isSendLinkExpired(c: Pick<ContractRow, "status" | "tokenExpiresAt">, now: Date = new Date()): boolean {
  return c.status === "SENT" && !!c.tokenExpiresAt && new Date(c.tokenExpiresAt) < now;
}
