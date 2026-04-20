import { prisma } from "@/lib/db/prisma";
import { TwilioSmsProvider } from "./twilio-provider";
import { createTrackedLinks } from "@/lib/services/tracking/tracked-links";
import { env } from "@/lib/env";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";

const twilio = new TwilioSmsProvider();

export async function sendLeadAlertSms(leadId: string, userId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, fullName: true, primaryPhone: true, city: true,
      services: { include: { serviceCategory: true } },
    },
  });
  if (!lead) throw new Error("Lead not found");

  // Get manager's alert settings or phone
  const alertSettings = await prisma.managerAlertSettings.findUnique({ where: { userId } });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  const phone = alertSettings?.smsPhoneNumber;
  if (!phone) {
    console.warn(`No SMS phone configured for user ${userId}`);
    return null;
  }

  if (alertSettings && !alertSettings.smsEnabled) {
    console.log(`SMS alerts disabled for user ${userId}`);
    return null;
  }

  // Generate tracked links
  const links = await createTrackedLinks(leadId, userId);

  const service = lead.services.map((s) => s.serviceCategory.name).join(", ") || "General";

  const messageBody = [
    `🔔 New Google Ads Lead:`,
    `${lead.fullName}`,
    `📞 ${lead.primaryPhone}`,
    `📍 ${lead.city || "—"} | ${service}`,
    ``,
    `Open: ${links.OPEN_LEAD}`,
    `✅ Ack: ${links.ACKNOWLEDGE}`,
    `📞 Call: ${links.START_CALL}`,
  ].join("\n");

  // Create notification event
  const notification = await prisma.notificationEvent.create({
    data: {
      leadId,
      recipientUserId: userId,
      channel: "SMS",
      provider: "twilio",
      recipientAddress: phone,
      messageBody,
      status: "QUEUED",
    },
  });

  try {
    const result = await twilio.sendMessage({
      to: phone,
      from: env.TWILIO_FROM_NUMBER || "",
      body: messageBody,
    });

    await prisma.notificationEvent.update({
      where: { id: notification.id },
      data: {
        providerMessageId: result.externalId,
        status: "SENT",
        sentAt: new Date(),
      },
    });

    // Update response metric
    await prisma.leadResponseMetric.update({
      where: { leadId },
      data: { smsSentAt: new Date() },
    }).catch(() => {}); // May not exist yet

    // Activity log
    await prisma.activityLog.create({
      data: {
        leadId,
        activityType: "SMS_LOGGED",
        title: "SMS alert sent to sales manager",
        description: `Sent to ${phone}`,
      },
    });

    return result;
  } catch (err) {
    await prisma.notificationEvent.update({
      where: { id: notification.id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });

    console.error(`SMS alert failed for lead ${leadId}:`, err);

    if (user?.email && isEmailConfigured()) {
      try {
        await sendEmail({
          to: user.email,
          subject: `🔔 New Lead: ${lead.fullName} (SMS failed)`,
          html: `<p>SMS alert to ${phone} failed — emailing you instead.</p>
<pre style="font-family:monospace">${messageBody.replace(/</g, "&lt;")}</pre>`,
          text: messageBody,
        });
        await prisma.notificationEvent.create({
          data: {
            leadId,
            recipientUserId: userId,
            channel: "EMAIL",
            provider: "resend",
            recipientAddress: user.email,
            messageBody,
            status: "SENT",
            sentAt: new Date(),
          },
        });
      } catch (emailErr) {
        console.error(`Email fallback also failed for lead ${leadId}:`, emailErr);
      }
    }

    throw err;
  }
}
