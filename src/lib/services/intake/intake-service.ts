import { prisma } from "@/lib/db/prisma";
import type { EmailInboxProvider } from "./email-provider";
import { parseGoogleAdsLeadEmail } from "./email-parser";
import { sendLeadAlertSms } from "@/lib/services/notifications/alert-service";

/**
 * Core intake pipeline:
 * 1. Fetch unread emails from provider
 * 2. Filter by allowed senders/subjects
 * 3. Check idempotency (external message ID)
 * 4. Parse email into lead fields
 * 5. Duplicate detection
 * 6. Create lead
 * 7. Send SMS alert
 */
export async function processInboundEmails(provider: EmailInboxProvider) {
  const settings = await prisma.intakeSettings.findFirst({
    where: { provider: provider.name, isActive: true },
  });

  const emails = await provider.fetchUnreadLeadEmails();
  const results: { messageId: string; status: string; leadId?: string }[] = [];

  for (const email of emails) {
    // Idempotency: skip if already processed
    const existing = await prisma.inboundEmailEvent.findUnique({
      where: { externalMessageId: email.externalMessageId },
    });
    if (existing) {
      results.push({ messageId: email.externalMessageId, status: "already_processed" });
      continue;
    }

    // Store raw email
    const event = await prisma.inboundEmailEvent.create({
      data: {
        provider: provider.name,
        externalMessageId: email.externalMessageId,
        senderEmail: email.senderEmail,
        subject: email.subject,
        receivedAt: email.receivedAt,
        rawBodyText: email.bodyText,
        rawBodyHtml: email.bodyHtml,
        processingStatus: "PROCESSING",
      },
    });

    // Filter by allowed senders
    if (settings?.allowedSenders) {
      const allowed = settings.allowedSenders as string[];
      if (allowed.length > 0 && !allowed.some((s) => email.senderEmail.toLowerCase().includes(s.toLowerCase()))) {
        await prisma.inboundEmailEvent.update({
          where: { id: event.id },
          data: { processingStatus: "IGNORED", processedAt: new Date() },
        });
        results.push({ messageId: email.externalMessageId, status: "ignored_sender" });
        continue;
      }
    }

    // Parse
    try {
      const parsed = parseGoogleAdsLeadEmail(email.bodyText || email.bodyHtml, email.subject);

      if (!parsed) {
        await prisma.inboundEmailEvent.update({
          where: { id: event.id },
          data: {
            processingStatus: "FAILED",
            parsingError: "Could not extract lead fields from email body",
            processedAt: new Date(),
          },
        });
        results.push({ messageId: email.externalMessageId, status: "parse_failed" });
        continue;
      }

      await prisma.inboundEmailEvent.update({
        where: { id: event.id },
        data: { parsedPayloadJson: parsed as object, processingStatus: "PARSED" },
      });

      // Duplicate detection
      const duplicates = await prisma.lead.findMany({
        where: {
          OR: [
            { primaryPhone: parsed.primaryPhone },
            ...(parsed.email ? [{ email: parsed.email }] : []),
          ],
        },
        select: { id: true },
        take: 1,
      });

      if (duplicates.length > 0) {
        await prisma.inboundEmailEvent.update({
          where: { id: event.id },
          data: { processingStatus: "DUPLICATE", leadId: duplicates[0].id, processedAt: new Date() },
        });
        results.push({ messageId: email.externalMessageId, status: "duplicate", leadId: duplicates[0].id });

        // Still mark as processed in mailbox
        await provider.markProcessed(email.externalMessageId).catch(() => {});
        continue;
      }

      // Get default stage and source
      const defaultStage = await prisma.leadStage.findFirst({ where: { name: "New Lead" } });
      if (!defaultStage) throw new Error("Default stage not configured");

      const googleAdsSource = await prisma.leadSource.findFirst({
        where: { name: { contains: "Google", mode: "insensitive" } },
      });

      // Get default assigned user
      const assignUserId = settings?.defaultAssignUserId || null;

      // Create lead
      const lead = await prisma.lead.create({
        data: {
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          fullName: `${parsed.firstName} ${parsed.lastName}`,
          primaryPhone: parsed.primaryPhone,
          email: parsed.email || null,
          propertyAddress1: parsed.propertyAddress1 || "TBD",
          city: parsed.city || "TBD",
          state: parsed.state || "FL",
          zipCode: parsed.zipCode || "00000",
          currentStageId: defaultStage.id,
          sourceId: googleAdsSource?.id || null,
          sourceDetail: parsed.campaignSource || "Google Ads Email",
          assignedUserId: assignUserId,
          createdByUserId: assignUserId || (await getSystemUserId()),
          notesSummary: parsed.notes || null,
          nextFollowUpAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
          isDuplicateFlag: false,
        },
      });

      // Activity log
      await prisma.activityLog.create({
        data: {
          leadId: lead.id,
          activityType: "LEAD_CREATED",
          title: "Lead auto-created from Google Ads email",
          description: `Source email: ${email.senderEmail} | Subject: ${email.subject}`,
          metadataJson: { emailEventId: event.id, campaign: parsed.campaignSource },
        },
      });

      // Create response metric
      await prisma.leadResponseMetric.create({
        data: {
          leadId: lead.id,
          emailReceivedAt: email.receivedAt,
          leadCreatedAt: new Date(),
          assignedUserId: assignUserId,
          source: "Google Ads",
        },
      });

      // Update email event
      await prisma.inboundEmailEvent.update({
        where: { id: event.id },
        data: { processingStatus: "LEAD_CREATED", leadId: lead.id, processedAt: new Date() },
      });

      // Mark processed in mailbox
      await provider.markProcessed(email.externalMessageId).catch(() => {});
      if (settings?.processedFolderName) {
        await provider.moveToFolder(email.externalMessageId, settings.processedFolderName).catch(() => {});
      }

      // Send SMS alert to assigned user
      if (assignUserId && settings?.twilioEnabled) {
        try {
          await sendLeadAlertSms(lead.id, assignUserId);
        } catch (err) {
          console.error("SMS alert failed:", err);
        }
      }

      results.push({ messageId: email.externalMessageId, status: "lead_created", leadId: lead.id });
    } catch (err) {
      await prisma.inboundEmailEvent.update({
        where: { id: event.id },
        data: {
          processingStatus: "FAILED",
          parsingError: err instanceof Error ? err.message : String(err),
          processedAt: new Date(),
        },
      });
      results.push({ messageId: email.externalMessageId, status: "error" });
    }
  }

  return results;
}

async function getSystemUserId(): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { role: { name: "ADMIN" }, isActive: true },
    select: { id: true },
  });
  return admin?.id || "";
}
