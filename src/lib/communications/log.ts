import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

type Channel = "SMS" | "EMAIL";

type LogOutboundArgs = {
  leadId: string;
  channel: Channel;
  provider: string;
  from: string;
  to: string;
  subject?: string | null;
  body: string;
  externalMessageId?: string | null;
  createdByUserId?: string | null;
};

type LogInboundArgs = {
  leadId: string;
  channel: Channel;
  provider: string;
  from: string;
  to: string;
  subject?: string | null;
  body: string;
  externalMessageId?: string | null;
  receivedAt?: Date;
};

export async function logOutboundCommunication(
  args: LogOutboundArgs,
): Promise<void> {
  const now = new Date();
  try {
    await prisma.$transaction([
      prisma.communication.create({
        data: {
          leadId: args.leadId,
          communicationType: args.channel,
          direction: "OUTBOUND",
          provider: args.provider,
          externalMessageId: args.externalMessageId ?? null,
          fromValue: args.from,
          toValue: args.to,
          subject: args.subject ?? null,
          body: args.body,
          status: "SENT",
          sentAt: now,
          createdByUserId: args.createdByUserId ?? null,
        },
      }),
      prisma.lead.update({
        where: { id: args.leadId },
        data: { lastContactAt: now },
      }),
    ]);
  } catch (err) {
    logger.exception(err, {
      where: "logOutboundCommunication",
      leadId: args.leadId,
      channel: args.channel,
    });
  }
}

export async function logInboundCommunication(
  args: LogInboundArgs,
): Promise<void> {
  const receivedAt = args.receivedAt ?? new Date();
  try {
    await prisma.$transaction([
      prisma.communication.create({
        data: {
          leadId: args.leadId,
          communicationType: args.channel,
          direction: "INBOUND",
          provider: args.provider,
          externalMessageId: args.externalMessageId ?? null,
          fromValue: args.from,
          toValue: args.to,
          subject: args.subject ?? null,
          body: args.body,
          status: "RECEIVED",
          receivedAt,
        },
      }),
      prisma.lead.update({
        where: { id: args.leadId },
        data: { lastContactAt: receivedAt },
      }),
    ]);
  } catch (err) {
    logger.exception(err, {
      where: "logInboundCommunication",
      leadId: args.leadId,
      channel: args.channel,
    });
  }
}
