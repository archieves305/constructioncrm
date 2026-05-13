/**
 * Idempotently seeds the recommended permit-inspection follow-up workflow:
 * 5 message templates (customer + crew) and 6 follow-up rules covering the
 * inspection lifecycle (scheduled → reminder → result).
 *
 * Run:  npx tsx scripts/seed-inspection-workflow.ts
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
    | "INSPECTION_SCHEDULED"
    | "INSPECTION_REMINDER_24H"
    | "INSPECTION_PASSED"
    | "INSPECTION_FAILED"
    | "INSPECTION_CONDITIONAL"
    | "INSPECTION_CANCELLED";
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
    name: "Inspection Scheduled — Customer Email",
    channel: "EMAIL",
    templateBody: `# Inspection scheduled, {{lead.firstName}}

The **{{inspection.type}}** inspection on permit #{{permit.permitNumber}} with **{{permit.municipality}}** is scheduled for **{{inspection.scheduledFor}}** at {{inspection.scheduledTime}}.

You don't need to do anything — our crew will handle it. We'll let you know the result the same day.

If something changes, call {{company.phone}}.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Inspection Reminder — Crew SMS",
    channel: "SMS",
    templateBody:
      "Reminder: {{inspection.type}} inspection tomorrow at {{inspection.scheduledTime}} for {{lead.fullName}} — permit #{{permit.permitNumber}} ({{permit.municipality}}). Inspector: {{inspection.inspectorName}}.",
  },
  {
    name: "Inspection Passed — Customer Email",
    channel: "EMAIL",
    templateBody: `# {{inspection.type}} inspection passed!

Quick win, {{lead.firstName}} — your **{{inspection.type}}** inspection with **{{permit.municipality}}** passed today.

We'll keep moving forward with your project. If this was the final inspection, you'll be hearing from us about close-out paperwork shortly.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Inspection Failed — Customer Email",
    channel: "EMAIL",
    templateBody: `# A quick update on today's inspection, {{lead.firstName}}

The **{{inspection.type}}** inspection with **{{permit.municipality}}** didn't pass today. This happens occasionally and is usually a small fix.

{{assignedTo.firstName}} will be in touch within 1 business day with the specific reason and our plan to remediate. Nothing for you to do right now.

If you'd like the details sooner, call {{company.phone}}.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Inspection Conditional — Coordinator SMS",
    channel: "SMS",
    templateBody:
      "Inspection {{inspection.type}} on {{lead.fullName}}'s permit #{{permit.permitNumber}} came back CONDITIONAL. Review notes and resolve the condition before scheduling final sign-off.",
  },
];

const RULES: RuleSpec[] = [
  // 1. Customer email when an inspection is scheduled.
  {
    name: "Inspection Scheduled: Customer Email",
    triggerEvent: "INSPECTION_SCHEDULED",
    delayMinutes: 0,
    messageTemplateName: "Inspection Scheduled — Customer Email",
  },
  // 2. T-24h SMS reminder to the crew (fires from the inspection-reminders cron).
  {
    name: "Inspection 24h Reminder: Crew SMS",
    triggerEvent: "INSPECTION_REMINDER_24H",
    delayMinutes: 0,
    messageTemplateName: "Inspection Reminder — Crew SMS",
  },
  // 3. Customer notification on pass.
  {
    name: "Inspection Passed: Customer Email",
    triggerEvent: "INSPECTION_PASSED",
    delayMinutes: 0,
    messageTemplateName: "Inspection Passed — Customer Email",
  },
  // 4. Customer notification on failure.
  {
    name: "Inspection Failed: Customer Email",
    triggerEvent: "INSPECTION_FAILED",
    delayMinutes: 0,
    messageTemplateName: "Inspection Failed — Customer Email",
  },
  // 5. URGENT internal task on failure — we need to remediate and reschedule.
  {
    name: "Inspection Failed: Reschedule + Remediate Task",
    triggerEvent: "INSPECTION_FAILED",
    delayMinutes: 0,
    task: {
      title:
        "Failed inspection ({{inspection.type}}) — remediate and reschedule",
      description:
        "Inspection at {{permit.municipality}} did not pass. Pull inspector's correction list, coordinate the fix with the crew lead, and book the re-inspection with the building department.",
      dueInDays: 1,
      priority: "URGENT",
    },
  },
  // 6. Coordinator SMS + task when result is CONDITIONAL.
  {
    name: "Inspection Conditional: Resolve-Condition Task",
    triggerEvent: "INSPECTION_CONDITIONAL",
    delayMinutes: 0,
    messageTemplateName: "Inspection Conditional — Coordinator SMS",
    task: {
      title:
        "Resolve condition on {{inspection.type}} inspection (permit #{{permit.permitNumber}})",
      description:
        "Inspector marked this CONDITIONAL. Address the listed condition with the crew lead, document the resolution, and notify {{permit.municipality}} for sign-off.",
      dueInDays: 3,
      priority: "HIGH",
    },
  },
];

async function main() {
  console.log("Seeding inspection follow-up workflow…\n");

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
