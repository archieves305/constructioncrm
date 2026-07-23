import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { emitLeadEvent } from "@/lib/follow-ups/events";

/**
 * Creates (or augments) a CRM lead from an inbound phone call routed by the KNU
 * phone-routing app. Mirrors the Google Ads email-intake pipeline
 * (src/lib/services/intake/intake-service.ts):
 *   - idempotent on the Telnyx call id (a retried POST returns the same lead)
 *   - dedupes by primaryPhone — a repeat caller augments the existing lead
 *     rather than creating a duplicate
 *   - missing address fields use the same "TBD"/"00000" placeholders the email
 *     pipeline uses (Lead requires them), to be enriched later via IVR/skip-trace
 *   - logs the call as a Communication (CALL/INBOUND) + ActivityLog
 *   - fires LEAD_CREATED so the follow-up automation (speed-to-lead) kicks in
 */
export interface PhoneLeadInput {
  callId: string;
  callerPhone: string;
  callerName?: string | null;
  toNumber?: string | null;
  department?: string | null;
  trade?: string | null; // maps to a ServiceCategory by name, e.g. "Roofing"
  status?: string | null;
  answered?: boolean;
  duringHours?: boolean;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  transcription?: string | null;
  aiSummary?: string | null;
  gclid?: string | null; // Google Ads click id (when available — P3)
  occurredAt?: string | null; // ISO timestamp of the call
  urgent?: boolean;
  insuranceClaim?: boolean;
  estimatedJobValue?: number | null;
}

export interface PhoneLeadResult {
  leadId: string;
  created: boolean;
  alreadyExists: boolean;
}

export async function createLeadFromPhoneCall(input: PhoneLeadInput): Promise<PhoneLeadResult> {
  // 1. Idempotency — a Communication already logged for this call id means we
  //    processed it; return the same lead without double-writing.
  const existingComm = await prisma.communication.findFirst({
    where: { externalMessageId: input.callId, communicationType: "CALL" },
    select: { leadId: true },
  });
  if (existingComm) {
    return { leadId: existingComm.leadId, created: false, alreadyExists: true };
  }

  const systemUserId = await resolveSystemUserId();
  if (!systemUserId) throw new Error("No system/admin user available for createdByUserId");

  const defaultStage = await prisma.leadStage.findFirst({ where: { name: "New Lead" } });
  if (!defaultStage) throw new Error("Default 'New Lead' stage not configured");

  const source = await resolvePhoneLeadSource();
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

  // 2. Dedupe by phone — augment an existing lead instead of duplicating.
  const existingLead = await prisma.lead.findFirst({
    where: { primaryPhone: input.callerPhone },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let leadId: string;
  let created = false;

  if (existingLead) {
    leadId = existingLead.id;
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        lastContactAt: occurredAt,
        ...(input.urgent ? { urgent: true } : {}),
        ...(input.insuranceClaim ? { insuranceClaim: true } : {}),
      },
    });
  } else {
    const name = splitCallerName(input.callerName, input.callerPhone);
    const lead = await prisma.lead.create({
      data: {
        firstName: name.first,
        lastName: name.last,
        fullName: name.full,
        primaryPhone: input.callerPhone,
        propertyAddress1: "TBD",
        city: "TBD",
        state: "FL",
        zipCode: "00000",
        currentStageId: defaultStage.id,
        sourceId: source?.id ?? null,
        sourceDetail: buildSourceDetail(input),
        createdByUserId: systemUserId,
        urgent: input.urgent ?? false,
        insuranceClaim: input.insuranceClaim ?? false,
        estimatedJobValue: input.estimatedJobValue ?? undefined,
        notesSummary: input.aiSummary ?? input.transcription ?? null,
        lastContactAt: occurredAt,
        nextFollowUpAt: new Date(Date.now() + 60 * 60 * 1000), // speed-to-lead: 1h
        isDuplicateFlag: false,
      },
      select: { id: true },
    });
    leadId = lead.id;
    created = true;

    // Trade → ServiceCategory (best-effort).
    if (input.trade) {
      const cat = await prisma.serviceCategory.findFirst({
        where: { name: { contains: input.trade, mode: "insensitive" }, isActive: true },
        select: { id: true },
      });
      if (cat) {
        await prisma.leadService
          .create({ data: { leadId, serviceCategoryId: cat.id } })
          .catch(() => {});
      }
    }

    await prisma.leadStageHistory.create({
      data: { leadId, toStageId: defaultStage.id, changedByUserId: systemUserId },
    });

    await prisma.leadResponseMetric
      .create({
        data: {
          leadId,
          leadCreatedAt: new Date(),
          startCallAt: occurredAt,
          assignedUserId: null,
          source: "Phone Call",
        },
      })
      .catch(() => {});
  }

  // 3. Log the call itself (also our idempotency marker for the call id).
  await prisma.communication.create({
    data: {
      leadId,
      communicationType: "CALL",
      direction: "INBOUND",
      provider: "telnyx",
      externalMessageId: input.callId,
      fromValue: input.callerPhone,
      toValue: input.toNumber || "",
      subject: input.department ? `Inbound call — ${input.department}` : "Inbound call",
      body: buildCallBody(input),
      status: "RECEIVED",
      receivedAt: occurredAt,
      createdByUserId: systemUserId,
    },
  });

  // 4. Activity log entry.
  await prisma.activityLog.create({
    data: {
      leadId,
      activityType: "CALL_LOGGED",
      title: created ? "Lead created from inbound call" : "Inbound call logged",
      description: buildCallBody(input),
      metadataJson: {
        callId: input.callId,
        department: input.department ?? null,
        gclid: input.gclid ?? null,
        answered: input.answered ?? null,
        durationSeconds: input.durationSeconds ?? null,
        recordingUrl: input.recordingUrl ?? null,
        duringHours: input.duringHours ?? null,
        status: input.status ?? null,
      },
      createdByUserId: systemUserId,
    },
  });

  // 5. Fire automation only for genuinely new leads (callback task, alerts).
  if (created) {
    await emitLeadEvent("LEAD_CREATED", leadId).catch((e) =>
      console.error("emitLeadEvent LEAD_CREATED (phone) failed", e),
    );
  }

  return { leadId, created, alreadyExists: false };
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function resolveSystemUserId(): Promise<string> {
  if (env.PHONE_ROUTING_SYSTEM_USER_ID) {
    const pinned = await prisma.user.findUnique({
      where: { id: env.PHONE_ROUTING_SYSTEM_USER_ID },
      select: { id: true },
    });
    if (pinned) return pinned.id;
  }
  const admin = await prisma.user.findFirst({
    where: { role: { name: "ADMIN" }, isActive: true },
    select: { id: true },
  });
  return admin?.id || "";
}

async function resolvePhoneLeadSource() {
  const existing = await prisma.leadSource.findFirst({
    where: { name: { equals: "Phone Call", mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing;
  // Create it on first use so the integration is self-bootstrapping.
  return prisma.leadSource
    .create({ data: { name: "Phone Call", channelType: "PAID" }, select: { id: true } })
    .catch(() => null);
}

function splitCallerName(
  name: string | null | undefined,
  phone: string,
): { first: string; last: string; full: string } {
  const trimmed = (name || "").trim();
  if (!trimmed) {
    return { first: "Unknown", last: "Caller", full: `Caller ${phone}` };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "(caller)", full: trimmed };
  return { first: parts[0], last: parts.slice(1).join(" "), full: trimmed };
}

function buildSourceDetail(input: PhoneLeadInput): string {
  const bits = ["Inbound call"];
  if (input.department) bits.push(input.department);
  if (input.gclid) bits.push("Google Ads");
  return bits.join(" — ");
}

function buildCallBody(input: PhoneLeadInput): string {
  const lines: string[] = [];
  if (input.aiSummary) lines.push(input.aiSummary);
  if (input.transcription && input.transcription !== input.aiSummary) {
    lines.push("", "Transcription:", input.transcription);
  }
  const meta: string[] = [];
  if (input.status) meta.push(`status: ${input.status}`);
  if (typeof input.answered === "boolean") meta.push(input.answered ? "answered" : "unanswered");
  if (input.durationSeconds != null) meta.push(`${input.durationSeconds}s`);
  if (typeof input.duringHours === "boolean") meta.push(input.duringHours ? "business hours" : "after hours");
  if (meta.length) lines.push(meta.join(" · "));
  if (input.recordingUrl) lines.push(`Recording: ${input.recordingUrl}`);
  return lines.join("\n").trim() || "Inbound call";
}
