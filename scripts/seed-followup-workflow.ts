/**
 * Idempotently seeds a recommended lead-followup workflow:
 * ~16 message templates (SMS + Email) and ~19 follow-up rules
 * spanning the full lead lifecycle (New Lead → Won/Lost).
 *
 * Run:  npx tsx scripts/seed-followup-workflow.ts
 *
 * Safe to re-run. Existing rows with matching names are left alone;
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
  triggerEvent: "LEAD_CREATED" | "LEAD_STAGE_CHANGED" | "LEAD_ASSIGNED";
  targetStageName?: string;
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
    name: "Welcome — SMS",
    channel: "SMS",
    templateBody:
      "Hi {{lead.firstName}}, thanks for reaching out to {{company.name}}! We got your request and {{assignedTo.firstName}} will reach out within the hour. Reply STOP to opt out.",
  },
  {
    name: "Welcome — Email",
    channel: "EMAIL",
    templateBody: `# Thanks for reaching out, {{lead.firstName}}!

We received your request at {{company.name}} and {{assignedTo.firstName}} is on it. You'll hear from {{assignedTo.firstName}} within the hour during business hours.

**What happens next:**

1. {{assignedTo.firstName}} will call to confirm details and schedule a free inspection
2. We come out, measure your roof, and give you a no-pressure estimate
3. You decide — no obligation

If you need anything before then, reach us at {{company.phone}}.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Day-After Nudge — SMS",
    channel: "SMS",
    templateBody:
      "Hi {{lead.firstName}}, just checking in — did {{assignedTo.firstName}} get hold of you yesterday? Reply here or call {{company.phone}} and we'll set up your free inspection. Reply STOP to opt out.",
  },
  {
    name: "Social Proof — Email",
    channel: "EMAIL",
    templateBody: `# Still looking at roofing options, {{lead.firstName}}?

We get it — picking a contractor is a big call. Quick reasons folks in {{lead.city}} pick {{company.name}}:

- Local, licensed, insured
- Free no-pressure inspections
- Financing available
- Insurance claim help

If you'd like to schedule that free inspection, just reply or call {{company.phone}}. {{assignedTo.firstName}} can usually fit you in this week.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Last-Chance (New Lead) — Email",
    channel: "EMAIL",
    templateBody: `# Closing the file unless we hear back, {{lead.firstName}}

We don't want to keep nudging you. If you're no longer interested, no worries — just reply "no thanks" and we'll close out your file.

If you're still on the fence, {{assignedTo.firstName}} is happy to answer questions, no pressure. Just call {{company.phone}}.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Contact Attempted — SMS",
    channel: "SMS",
    templateBody:
      "Hi {{lead.firstName}}, this is {{assignedTo.firstName}} at {{company.name}}. I tried reaching you about your roofing inquiry. Give me a call back at {{company.phone}} when you have a sec. Reply STOP to opt out.",
  },
  {
    name: "Appointment Confirmation — Email",
    channel: "EMAIL",
    templateBody: `# Inspection confirmed, {{lead.firstName}}

Thanks for scheduling your free roof inspection with {{company.name}}. {{assignedTo.firstName}} will be by soon.

**A few quick tips before we come out:**

- We don't need access inside — we'll work from the exterior
- If you have any photos of leaks or damage, have them ready
- Inspection takes about 30–45 minutes

If anything changes, call {{company.phone}}.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Inspection Complete — SMS",
    channel: "SMS",
    templateBody:
      "Thanks {{lead.firstName}}! Inspection done. {{assignedTo.firstName}} will have your estimate to you within 24 hours. Reply STOP to opt out.",
  },
  {
    name: "Estimate Delivered — Email",
    channel: "EMAIL",
    templateBody: `# Your roofing estimate, {{lead.firstName}}

{{assignedTo.firstName}} has sent over your estimate from {{company.name}}. Take your time reviewing it — and if anything's unclear, we're an easy phone call away at {{company.phone}}.

**A few things worth knowing:**

- **Financing** — we work with several lenders if you'd prefer monthly payments instead of paying upfront
- **Insurance** — if this is a claim, we can help with the paperwork and adjuster meetings
- **Material upgrades** — happy to walk through options on shingle grade, color, warranty

When you're ready to move forward (or just want to chat through it), reply here or call {{company.phone}}.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Estimate Follow-Up 2d — SMS",
    channel: "SMS",
    templateBody:
      "Hi {{lead.firstName}}, this is {{assignedTo.firstName}} at {{company.name}}. Any questions on your estimate? Happy to walk through anything. Reply STOP to opt out.",
  },
  {
    name: "Estimate Follow-Up 5d — Email",
    channel: "EMAIL",
    templateBody: `# Just checking back, {{lead.firstName}}

Your estimate from {{company.name}} is still good — and I wanted to make sure you didn't have any questions I could help with.

Whether you're comparing quotes, sorting out timing, or working through an insurance claim, I'm happy to be a sounding board. No pressure.

Reach me at {{company.phone}} or just reply here.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Estimate Closing 10d — Email",
    channel: "EMAIL",
    templateBody: `# Closing the file unless we hear back, {{lead.firstName}}

Just a heads-up — if I don't hear from you in the next few days I'll close out your file at {{company.name}}. No worries either way; just don't want to keep cluttering your inbox.

If your timing's just off, reply with when works better and I'll circle back then.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Won — Welcome Aboard Email",
    channel: "EMAIL",
    templateBody: `# Welcome aboard, {{lead.firstName}}!

Thanks for trusting {{company.name}} with your roof. {{assignedTo.firstName}} will be your point of contact through the whole job.

**What happens next:**

1. {{assignedTo.firstName}} will reach out to confirm scheduling and walk through next steps
2. We finalize material selection and any color/upgrade choices
3. We coordinate any permits or HOA approval
4. Crew arrives on the scheduled day

If you have any questions at all, call {{company.phone}} or reply here.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Won — Contract SMS",
    channel: "SMS",
    templateBody:
      "Hi {{lead.firstName}}, {{assignedTo.firstName}} here. Your roofing contract should be in your inbox — let me know if you have any trouble finding it. Call {{company.phone}} anytime.",
  },
  {
    name: "Lost — Polite Goodbye Email",
    channel: "EMAIL",
    templateBody: `# Sorry we couldn't help this time, {{lead.firstName}}

Totally understand if you went a different direction. If you ever need anything roofing-related down the road — second opinion on storm damage, leak check, insurance claim help — feel free to call {{company.phone}}. No pressure, no follow-ups.

Wishing you the best.

— {{assignedTo.firstName}} at {{company.name}}`,
  },
  {
    name: "Lost — 90-Day Re-Engagement Email",
    channel: "EMAIL",
    templateBody: `# Quick check-in, {{lead.firstName}}

It's been a few months since we talked at {{company.name}}. Wanted to send a one-off note in case anything's come up with your roof — leaks, storm damage, or just due for a check-up.

If everything's good, ignore this. If something's off, we offer free inspections anytime — just call {{company.phone}}.

— {{company.name}}`,
  },
];

const RULES: RuleSpec[] = [
  // ─── LEAD_CREATED drip ──────────────────────────────────────────────
  {
    name: "New Lead: Welcome SMS",
    triggerEvent: "LEAD_CREATED",
    delayMinutes: 0,
    messageTemplateName: "Welcome — SMS",
  },
  {
    name: "New Lead: Welcome Email",
    triggerEvent: "LEAD_CREATED",
    delayMinutes: 5,
    messageTemplateName: "Welcome — Email",
  },
  {
    name: "New Lead: Speed-to-Lead Task",
    triggerEvent: "LEAD_CREATED",
    delayMinutes: 0,
    task: {
      title: "Call {{lead.firstName}} now (speed-to-lead)",
      description:
        "First contact within minutes wins. Call {{lead.primaryPhone}}.",
      dueInDays: 0,
      priority: "URGENT",
    },
  },
  {
    name: "New Lead: Day-After SMS Nudge",
    triggerEvent: "LEAD_CREATED",
    delayMinutes: 1440,
    messageTemplateName: "Day-After Nudge — SMS",
  },
  {
    name: "New Lead: 48h Social Proof Email",
    triggerEvent: "LEAD_CREATED",
    delayMinutes: 2880,
    messageTemplateName: "Social Proof — Email",
  },
  {
    name: "New Lead: 5-Day Last-Chance Email",
    triggerEvent: "LEAD_CREATED",
    delayMinutes: 7200,
    messageTemplateName: "Last-Chance (New Lead) — Email",
  },

  // ─── LEAD_STAGE_CHANGED rules ──────────────────────────────────────
  {
    name: "Stage Contact Attempted: Tried-You SMS",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Contact Attempted",
    delayMinutes: 120,
    messageTemplateName: "Contact Attempted — SMS",
  },
  {
    name: "Stage Appointment Scheduled: Confirmation Email",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Appointment Scheduled",
    delayMinutes: 0,
    messageTemplateName: "Appointment Confirmation — Email",
  },
  {
    name: "Stage Inspection Completed: Estimate-Coming SMS",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Inspection Completed",
    delayMinutes: 0,
    messageTemplateName: "Inspection Complete — SMS",
  },
  {
    name: "Stage Inspection Completed: Send-Estimate Task",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Inspection Completed",
    delayMinutes: 240,
    task: {
      title: "Send estimate to {{lead.firstName}}",
      description:
        "Inspection is done. Build and send the estimate before the 24h SMS commitment elapses.",
      dueInDays: 1,
      priority: "HIGH",
    },
  },
  {
    name: "Stage Estimate Sent: Delivered Email",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Estimate Sent",
    delayMinutes: 0,
    messageTemplateName: "Estimate Delivered — Email",
  },
  {
    name: "Stage Estimate Sent: 2-Day SMS Follow-Up",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Estimate Sent",
    delayMinutes: 2880,
    messageTemplateName: "Estimate Follow-Up 2d — SMS",
  },
  {
    name: "Stage Estimate Sent: 5-Day Email Follow-Up",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Estimate Sent",
    delayMinutes: 7200,
    messageTemplateName: "Estimate Follow-Up 5d — Email",
  },
  {
    name: "Stage Estimate Sent: 10-Day Closing Email",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Estimate Sent",
    delayMinutes: 14400,
    messageTemplateName: "Estimate Closing 10d — Email",
  },
  {
    name: "Stage Follow-Up Needed: Manual Task",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Follow-Up Needed",
    delayMinutes: 0,
    task: {
      title: "Follow up with {{lead.firstName}}",
      description: "Lead moved to Follow-Up Needed. Call/text/email to re-engage.",
      dueInDays: 1,
      priority: "HIGH",
    },
  },
  {
    name: "Stage Won: Welcome-Aboard Email",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Won",
    delayMinutes: 0,
    messageTemplateName: "Won — Welcome Aboard Email",
  },
  {
    name: "Stage Won: Day-1 Contract SMS",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Won",
    delayMinutes: 1440,
    messageTemplateName: "Won — Contract SMS",
  },
  {
    name: "Stage Lost: Polite-Goodbye Email",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Lost",
    delayMinutes: 0,
    messageTemplateName: "Lost — Polite Goodbye Email",
  },
  {
    name: "Stage Lost: 90-Day Re-Engagement Email",
    triggerEvent: "LEAD_STAGE_CHANGED",
    targetStageName: "Lost",
    delayMinutes: 60 * 24 * 90, // 90 days in minutes
    messageTemplateName: "Lost — 90-Day Re-Engagement Email",
  },
];

async function main() {
  console.log("Seeding follow-up workflow…\n");

  // 1. Index existing stages by name
  const stages = await prisma.leadStage.findMany();
  const stageByName = new Map(stages.map((s) => [s.name, s]));

  // 2. Index/create templates by name
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

  // 3. Index/create rules by name
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

    let targetStageId: string | null = null;
    if (spec.targetStageName) {
      const stage = stageByName.get(spec.targetStageName);
      if (!stage) {
        console.warn(
          `  ! skip rule "${spec.name}" — stage "${spec.targetStageName}" not found`,
        );
        skippedRules++;
        continue;
      }
      targetStageId = stage.id;
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
        targetStageId,
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
