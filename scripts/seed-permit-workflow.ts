/**
 * Idempotently seeds the recommended permit-tracking follow-up workflow:
 * 7 message templates (mixed customer + internal) and 12 follow-up rules
 * covering the permit lifecycle (submitted → aging → issued → final).
 *
 * Run:  npx tsx scripts/seed-permit-workflow.ts
 *
 * Safe to re-run. Rows are matched by name; existing rows are left alone,
 * missing rows are created. No deletions.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type TemplateSpec = {
  name: string;
  channel: "SMS" | "EMAIL";
  templateBody: string;
};

type RuleSpec = {
  name: string;
  triggerEvent:
    | "PERMIT_CREATED"
    | "PERMIT_STATUS_APPLIED"
    | "PERMIT_STATUS_IN_PROGRESS"
    | "PERMIT_STATUS_ISSUED"
    | "PERMIT_STATUS_FINAL"
    | "PERMIT_STATUS_EXPIRED"
    | "PERMIT_STATUS_DENIED"
    | "PERMIT_AGING_7D"
    | "PERMIT_AGING_14D"
    | "PERMIT_EXPIRING_30D";
  delayMinutes: number;
  messageTemplateName?: string;
  task?: {
    title: string;
    description?: string;
    dueInDays: number;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  };
};

const TEMPLATES: TemplateSpec[] = [
  {
    name: "Permit Submitted — Customer Email",
    channel: "EMAIL",
    templateBody: `# Your permit is in, {{lead.firstName}}

We've submitted your permit application to **{{permit.municipality}}** for the work at {{lead.addressLine1}}.

**What happens next:**

1. {{permit.municipality}} reviews the application
2. Once it's issued we'll schedule your install
3. We'll keep you posted at each step — no chasing us down

Typical review takes 1–3 weeks depending on the municipality. If you have any questions in the meantime, just reply or call {{company.phone}}.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Permit In Progress — Customer Email",
    channel: "EMAIL",
    templateBody: `# Permit is under review, {{lead.firstName}}

Quick update — your permit application with **{{permit.municipality}}** is now actively under review. Nothing for you to do; we'll let you know the moment it's approved.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Permit Issued — Customer Email",
    channel: "EMAIL",
    templateBody: `# Good news — your permit was approved, {{lead.firstName}}!

**{{permit.municipality}}** has issued permit #{{permit.permitNumber}} for your project. We'll be in touch within the next couple of days to confirm install scheduling.

If you have any questions in the meantime, reach me at {{company.phone}}.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Permit Denied — Customer Email",
    channel: "EMAIL",
    templateBody: `# A quick note about your permit, {{lead.firstName}}

We received a denial notice from **{{permit.municipality}}** on permit #{{permit.permitNumber}}. This happens occasionally — usually it's a paperwork fix or a small plan revision.

{{assignedTo.firstName}} will be in touch within 1 business day with the specific reason and our plan to resubmit. Nothing for you to do right now.

If you'd like to chat through it sooner, call {{company.phone}}.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Permit Final — Customer Email",
    channel: "EMAIL",
    templateBody: `# Final inspection passed, {{lead.firstName}}!

**{{permit.municipality}}** has signed off on the final inspection for permit #{{permit.permitNumber}}. That's the last municipal step — your project is officially closed out with the building department.

We'll be sending your warranty packet and close-out paperwork shortly.

Thanks again for trusting {{company.name}} with your home.

— {{assignedTo.firstName}}`,
  },
  {
    name: "Permit Aging — Coordinator SMS",
    channel: "SMS",
    templateBody:
      "Heads up — permit #{{permit.permitNumber}} at {{permit.municipality}} ({{lead.fullName}}) has been open {{permit.agingDays}} days with no movement. Time to call the building department.",
  },
  {
    name: "Permit Expiring — Coordinator SMS",
    channel: "SMS",
    templateBody:
      "Permit #{{permit.permitNumber}} ({{permit.municipality}}) expires {{permit.expirationDate}}. Get the final inspection scheduled on {{lead.fullName}}'s job before then.",
  },
];

const RULES: RuleSpec[] = [
  // 1. Customer reassurance immediately after we submit a permit.
  {
    name: "Permit Created: Customer Submission Email",
    triggerEvent: "PERMIT_CREATED",
    delayMinutes: 0,
    messageTemplateName: "Permit Submitted — Customer Email",
  },
  // 2. Internal: confirm with municipality that they received it.
  {
    name: "Permit Created: Confirm-Receipt Task",
    triggerEvent: "PERMIT_CREATED",
    delayMinutes: 0,
    task: {
      title:
        "Confirm {{permit.municipality}} received permit #{{permit.permitNumber}}",
      description:
        "Call/email the building department to confirm the application is logged and assigned to a reviewer.",
      dueInDays: 2,
      priority: "MEDIUM",
    },
  },
  // 3. Customer status update when permit enters active review.
  {
    name: "Permit In Progress: Customer Update Email",
    triggerEvent: "PERMIT_STATUS_IN_PROGRESS",
    delayMinutes: 0,
    messageTemplateName: "Permit In Progress — Customer Email",
  },
  // 4. Coordinator alarm at 7 days with no movement.
  {
    name: "Permit Aging 7d: Coordinator Follow-Up Task",
    triggerEvent: "PERMIT_AGING_7D",
    delayMinutes: 0,
    messageTemplateName: "Permit Aging — Coordinator SMS",
    task: {
      title:
        "Call {{permit.municipality}} on permit #{{permit.permitNumber}} (7d aged)",
      description:
        "Permit has been open with no status change for 7 days. Call the building department to check on review status and document the response.",
      dueInDays: 1,
      priority: "HIGH",
    },
  },
  // 5. Escalation at 14 days.
  {
    name: "Permit Aging 14d: Escalate Task",
    triggerEvent: "PERMIT_AGING_14D",
    delayMinutes: 0,
    task: {
      title:
        "ESCALATE: permit #{{permit.permitNumber}} aged 14+ days at {{permit.municipality}}",
      description:
        "Loop in a manager. Determine whether to push the municipality, withdraw and resubmit, or contact the customer to set expectations. Document the plan.",
      dueInDays: 1,
      priority: "URGENT",
    },
  },
  // 6. Customer notification on issue.
  {
    name: "Permit Issued: Customer Approval Email",
    triggerEvent: "PERMIT_STATUS_ISSUED",
    delayMinutes: 0,
    messageTemplateName: "Permit Issued — Customer Email",
  },
  // 7. Internal: schedule the install crew.
  {
    name: "Permit Issued: Schedule Install Task",
    triggerEvent: "PERMIT_STATUS_ISSUED",
    delayMinutes: 0,
    task: {
      title: "Schedule install crew for {{lead.fullName}}",
      description:
        "Permit #{{permit.permitNumber}} is approved. Coordinate with production manager and crew lead, then confirm date with the customer.",
      dueInDays: 3,
      priority: "HIGH",
    },
  },
  // 8. Customer note when permit is denied.
  {
    name: "Permit Denied: Customer Notification Email",
    triggerEvent: "PERMIT_STATUS_DENIED",
    delayMinutes: 0,
    messageTemplateName: "Permit Denied — Customer Email",
  },
  // 9. Internal urgent task on denial.
  {
    name: "Permit Denied: Review & Resubmit Task",
    triggerEvent: "PERMIT_STATUS_DENIED",
    delayMinutes: 0,
    task: {
      title:
        "Permit #{{permit.permitNumber}} denied at {{permit.municipality}} — review",
      description:
        "Pull the denial reason from the municipality, fix the deficiency (plan revision, missing doc, fee, etc.), and resubmit. Update the customer with the plan and new expected timeline.",
      dueInDays: 1,
      priority: "URGENT",
    },
  },
  // 10. Customer congratulations on final.
  {
    name: "Permit Final: Customer Close-Out Email",
    triggerEvent: "PERMIT_STATUS_FINAL",
    delayMinutes: 0,
    messageTemplateName: "Permit Final — Customer Email",
  },
  // 11. Office close-out paperwork task.
  {
    name: "Permit Final: Office Close-Out Task",
    triggerEvent: "PERMIT_STATUS_FINAL",
    delayMinutes: 0,
    task: {
      title: "Send warranty packet + close-out paperwork to {{lead.firstName}}",
      description:
        "Permit #{{permit.permitNumber}} is finaled. Send the customer their warranty packet and any required close-out documentation, and archive the permit folder.",
      dueInDays: 5,
      priority: "MEDIUM",
    },
  },
  // 12. Expiry warning 30 days out.
  {
    name: "Permit Expiring 30d: Push-to-Final Task",
    triggerEvent: "PERMIT_EXPIRING_30D",
    delayMinutes: 0,
    messageTemplateName: "Permit Expiring — Coordinator SMS",
    task: {
      title:
        "Permit #{{permit.permitNumber}} expires {{permit.expirationDate}} — push to final",
      description:
        "Coordinate the final inspection with the crew lead and {{permit.municipality}} before the permit lapses. If a renewal/extension is needed, file it now.",
      dueInDays: 7,
      priority: "HIGH",
    },
  },
];

async function main() {
  console.log("Seeding permit follow-up workflow…\n");

  // 1. Index/create templates by name (idempotent).
  const templateByName = new Map<string, { id: string }>();
  let createdTemplates = 0;
  let existingTemplates = 0;
  for (const spec of TEMPLATES) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { name: spec.name },
    });
    if (existing) {
      templateByName.set(spec.name, existing);
      existingTemplates++;
      continue;
    }
    const created = await prisma.messageTemplate.create({
      data: {
        name: spec.name,
        channel: spec.channel,
        templateBody: spec.templateBody,
        isActive: true,
      },
    });
    templateByName.set(spec.name, created);
    createdTemplates++;
    console.log(`  + template "${spec.name}" (${spec.channel})`);
  }

  // 2. Index/create rules by name (idempotent).
  let createdRules = 0;
  let existingRules = 0;
  let skippedRules = 0;
  for (const spec of RULES) {
    const existing = await prisma.followUpRule.findFirst({
      where: { name: spec.name },
    });
    if (existing) {
      existingRules++;
      continue;
    }

    let messageTemplateId: string | null = null;
    if (spec.messageTemplateName) {
      const tpl = templateByName.get(spec.messageTemplateName);
      if (!tpl) {
        console.warn(
          `  ! skip rule "${spec.name}" — template "${spec.messageTemplateName}" not found`,
        );
        skippedRules++;
        continue;
      }
      messageTemplateId = tpl.id;
    }

    await prisma.followUpRule.create({
      data: {
        name: spec.name,
        triggerEvent: spec.triggerEvent,
        targetStageId: null,
        delayMinutes: spec.delayMinutes,
        messageTemplateId,
        taskTemplateJson: spec.task ?? undefined,
        isActive: true,
      },
    });
    createdRules++;
    console.log(`  + rule "${spec.name}"`);
  }

  console.log(
    `\nDone.\n  Templates: ${createdTemplates} created, ${existingTemplates} already existed.\n  Rules: ${createdRules} created, ${existingRules} already existed, ${skippedRules} skipped.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
