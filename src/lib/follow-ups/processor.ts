import { prisma } from "@/lib/db/prisma";
import { renderTemplate } from "@/lib/templates/render";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { getEmailBrand } from "@/lib/email/brand";
import {
  renderLeadEmail,
  type PermitTemplateContext,
  type InspectionTemplateContext,
} from "@/lib/email/render-template";
import { buildUnsubscribeUrl } from "@/lib/email/unsubscribe";
import { TwilioSmsProvider } from "@/lib/services/notifications/twilio-provider";
import { env } from "@/lib/env";

const ISO_DATE = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";

const ISO_TIME = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(11, 16) : "";

const twilio = new TwilioSmsProvider();

type ProcessResult = {
  processed: number;
  sent: number;
  failed: number;
  cancelled: number;
};

export async function processPendingFollowUps(limit = 50): Promise<ProcessResult> {
  const now = new Date();
  const pending = await prisma.followUpExecution.findMany({
    where: { status: "PENDING", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    include: {
      rule: { include: { messageTemplate: true } },
      lead: {
        include: {
          assignedUser: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              signatureHtml: true,
              signatureText: true,
            },
          },
        },
      },
      permit: true,
      inspection: true,
    },
  });

  const result: ProcessResult = { processed: 0, sent: 0, failed: 0, cancelled: 0 };

  for (const exec of pending) {
    result.processed += 1;

    if (!exec.rule.isActive) {
      await prisma.followUpExecution.update({
        where: { id: exec.id },
        data: { status: "CANCELLED", executedAt: new Date() },
      });
      result.cancelled += 1;
      continue;
    }

    let inspectionCtx: InspectionTemplateContext | undefined;
    if (exec.inspection) {
      inspectionCtx = {
        type: exec.inspection.type ?? "",
        scheduledFor: ISO_DATE(exec.inspection.scheduledFor),
        scheduledTime: ISO_TIME(exec.inspection.scheduledFor),
        completedAt: ISO_DATE(exec.inspection.completedAt),
        result: exec.inspection.result ?? "",
        inspectorName: exec.inspection.inspectorName ?? "",
      };
    }

    let permitCtx: PermitTemplateContext | undefined;
    if (exec.permit) {
      const submitted = exec.permit.submittedDate
        ? new Date(exec.permit.submittedDate).getTime()
        : null;
      const agingDays = submitted
        ? Math.floor((Date.now() - submitted) / 86400000).toString()
        : "";
      permitCtx = {
        municipality: exec.permit.municipality ?? "",
        permitNumber: exec.permit.permitNumber ?? "",
        permitType: exec.permit.permitType ?? "",
        status: exec.permit.status ?? "",
        submittedDate: ISO_DATE(exec.permit.submittedDate),
        expectedApprovalDate: ISO_DATE(exec.permit.expectedApprovalDate),
        approvedDate: ISO_DATE(exec.permit.approvedDate),
        expirationDate: ISO_DATE(exec.permit.expirationDate),
        inspectorName: exec.permit.inspectorName ?? "",
        agingDays,
      };
    }

    const context = {
      lead: {
        id: exec.lead.id,
        firstName: exec.lead.firstName,
        lastName: exec.lead.lastName,
        fullName: exec.lead.fullName,
        primaryPhone: exec.lead.primaryPhone,
        email: exec.lead.email ?? "",
        city: exec.lead.city ?? "",
        addressLine1: exec.lead.propertyAddress1 ?? "",
      },
      assignedTo: {
        firstName: exec.lead.assignedUser?.firstName ?? "",
        lastName: exec.lead.assignedUser?.lastName ?? "",
        signatureHtml: exec.lead.assignedUser?.signatureHtml ?? null,
        signatureText: exec.lead.assignedUser?.signatureText ?? null,
      },
      company: { name: exec.lead.companyName ?? "" },
      permit: permitCtx,
      inspection: inspectionCtx,
    };

    try {
      const template = exec.rule.messageTemplate;
      if (template) {
        const body = renderTemplate(template.templateBody, context);

        if (template.channel === "SMS") {
          if (!exec.lead.primaryPhone) throw new Error("lead has no phone");
          await twilio.sendMessage({
            to: exec.lead.primaryPhone,
            from: env.TWILIO_FROM_NUMBER || "",
            body,
          });
          await prisma.notificationEvent.create({
            data: {
              leadId: exec.leadId,
              recipientUserId: exec.lead.assignedUserId || exec.lead.createdByUserId,
              channel: "SMS",
              provider: "twilio",
              recipientAddress: exec.lead.primaryPhone,
              messageBody: body,
              status: "SENT",
              sentAt: new Date(),
            },
          });
        } else if (template.channel === "EMAIL") {
          if (!exec.lead.email) throw new Error("lead has no email");
          if (exec.lead.emailOptedOut) throw new Error("lead has unsubscribed from email");
          if (!isEmailConfigured()) throw new Error("email provider not configured");

          const brand = await getEmailBrand();
          const rendered = renderLeadEmail({
            templateBody: template.templateBody,
            context,
            brand,
            includeUnsubscribe: true,
          });

          await sendEmail({
            to: exec.lead.email,
            subject: renderTemplate(template.name, { ...context, company: { ...context.company, brand: brand.companyName } }),
            html: rendered.html,
            text: rendered.text,
            // Route replies to the assigned rep so customers reach a human,
            // not the system FROM address.
            replyTo: exec.lead.assignedUser?.email ?? undefined,
            headers: {
              "List-Unsubscribe": `<${buildUnsubscribeUrl(exec.leadId)}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          });
          await prisma.notificationEvent.create({
            data: {
              leadId: exec.leadId,
              recipientUserId: exec.lead.assignedUserId || exec.lead.createdByUserId,
              channel: "EMAIL",
              provider: "mailersend",
              recipientAddress: exec.lead.email,
              messageBody: body,
              status: "SENT",
              sentAt: new Date(),
            },
          });
        } else if (template.channel === "IN_APP") {
          await prisma.notificationEvent.create({
            data: {
              leadId: exec.leadId,
              recipientUserId: exec.lead.assignedUserId || exec.lead.createdByUserId,
              channel: "IN_APP",
              provider: "internal",
              recipientAddress: "in-app",
              messageBody: body,
              status: "SENT",
              sentAt: new Date(),
            },
          });
        }
      }

      const taskTemplate = exec.rule.taskTemplateJson as
        | { title?: string; description?: string; dueInDays?: number; priority?: string }
        | null;
      if (taskTemplate?.title) {
        const due = taskTemplate.dueInDays
          ? new Date(Date.now() + taskTemplate.dueInDays * 86400000)
          : null;
        await prisma.task.create({
          data: {
            leadId: exec.leadId,
            title: renderTemplate(taskTemplate.title, context),
            description: taskTemplate.description
              ? renderTemplate(taskTemplate.description, context)
              : null,
            priority: (taskTemplate.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT") || "MEDIUM",
            dueAt: due,
            assignedUserId: exec.lead.assignedUserId,
            createdByUserId: exec.lead.createdByUserId,
          },
        });
      }

      await prisma.followUpExecution.update({
        where: { id: exec.id },
        data: {
          status: "SENT",
          executedAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      result.sent += 1;
    } catch (err) {
      await prisma.followUpExecution.update({
        where: { id: exec.id },
        data: {
          status: "FAILED",
          executedAt: new Date(),
          attemptCount: { increment: 1 },
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      result.failed += 1;
    }
  }

  return result;
}
