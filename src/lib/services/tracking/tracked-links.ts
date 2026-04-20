import { prisma } from "@/lib/db/prisma";
import { randomBytes } from "crypto";
import type { TrackedActionType } from "@/generated/prisma/client";
import { env } from "@/lib/env";

const BASE_URL = env.NEXTAUTH_URL;

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createTrackedLinks(leadId: string, userId: string) {
  const actions: TrackedActionType[] = [
    "OPEN_LEAD",
    "ACKNOWLEDGE",
    "START_CALL",
    "MARK_ATTEMPTED",
    "MARK_CONTACTED",
  ];

  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

  const links: Record<string, string> = {};

  for (const action of actions) {
    const token = generateToken();
    await prisma.trackedActionLink.create({
      data: {
        token,
        leadId,
        userId,
        actionType: action,
        expiresAt,
      },
    });
    links[action] = `${BASE_URL}/action/${token}`;
  }

  return links;
}

export async function resolveTrackedLink(token: string, ip?: string, ua?: string) {
  const link = await prisma.trackedActionLink.findUnique({ where: { token } });

  if (!link) return { error: "Invalid link" };
  if (link.expiresAt < new Date()) return { error: "Link expired" };

  // Record first click
  if (!link.clickedAt) {
    await prisma.trackedActionLink.update({
      where: { id: link.id },
      data: {
        clickedAt: new Date(),
        ipAddress: ip || null,
        userAgent: ua || null,
      },
    });
  }

  // Update response metrics
  const now = new Date();
  const metric = await prisma.leadResponseMetric.findUnique({ where: { leadId: link.leadId } });

  if (metric) {
    const updates: Record<string, Date> = {};
    switch (link.actionType) {
      case "OPEN_LEAD":
        if (!metric.firstOpenAt) updates.firstOpenAt = now;
        break;
      case "ACKNOWLEDGE":
        if (!metric.acknowledgedAt) updates.acknowledgedAt = now;
        break;
      case "START_CALL":
        if (!metric.startCallAt) updates.startCallAt = now;
        break;
      case "MARK_ATTEMPTED":
        if (!metric.firstAttemptAt) updates.firstAttemptAt = now;
        break;
      case "MARK_CONTACTED":
        if (!metric.firstContactedAt) {
          updates.firstContactedAt = now;
        }
        break;
    }

    if (Object.keys(updates).length > 0) {
      // Calculate response time as seconds from email received to first action
      const responseTime = metric.emailReceivedAt
        ? Math.round((now.getTime() - metric.emailReceivedAt.getTime()) / 1000)
        : null;

      await prisma.leadResponseMetric.update({
        where: { leadId: link.leadId },
        data: {
          ...updates,
          ...(link.actionType === "ACKNOWLEDGE" && responseTime && !metric.responseTimeSeconds
            ? { responseTimeSeconds: responseTime }
            : {}),
        },
      });
    }
  }

  // Update lead stage if applicable
  if (link.actionType === "MARK_ATTEMPTED") {
    const attemptedStage = await prisma.leadStage.findFirst({ where: { name: "Contact Attempted" } });
    if (attemptedStage) {
      await prisma.lead.update({
        where: { id: link.leadId },
        data: { currentStageId: attemptedStage.id, lastContactAt: now },
      });
    }
  } else if (link.actionType === "MARK_CONTACTED") {
    const contactedStage = await prisma.leadStage.findFirst({ where: { name: "Contacted" } });
    if (contactedStage) {
      await prisma.lead.update({
        where: { id: link.leadId },
        data: { currentStageId: contactedStage.id, lastContactAt: now },
      });
    }
  }

  return { success: true, leadId: link.leadId, actionType: link.actionType, userId: link.userId };
}
