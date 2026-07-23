import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyPhoneRoutingAuth } from "@/lib/integrations/phone-routing/auth";
import { createLeadFromPhoneCall } from "@/lib/integrations/phone-routing/lead-service";

// POST /api/integrations/phone-routing/lead
//
// Called by the KNU phone-routing app when an inbound call should become (or
// augment) a CRM lead. Bearer-auth via PHONE_ROUTING_API_KEY. Idempotent on
// `callId` (the Telnyx call_control_id): a retried POST returns the same lead
// with alreadyExists=true. Dedupes by phone — a repeat caller augments the
// existing lead instead of creating a duplicate.

const inputSchema = z.object({
  callId: z.string().min(1).max(200),
  callerPhone: z.string().min(7).max(20),
  callerName: z.string().max(160).nullable().optional(),
  toNumber: z.string().max(20).nullable().optional(),
  department: z.string().max(120).nullable().optional(),
  trade: z.string().max(80).nullable().optional(),
  status: z.string().max(40).nullable().optional(),
  answered: z.boolean().optional(),
  duringHours: z.boolean().optional(),
  durationSeconds: z.number().int().nonnegative().nullable().optional(),
  recordingUrl: z.string().url().nullable().optional(),
  transcription: z.string().max(20000).nullable().optional(),
  aiSummary: z.string().max(4000).nullable().optional(),
  gclid: z.string().max(255).nullable().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  urgent: z.boolean().optional(),
  insuranceClaim: z.boolean().optional(),
  estimatedJobValue: z.number().positive().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const authFail = verifyPhoneRoutingAuth(request);
  if (authFail) return authFail;

  const body = await request.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "invalid payload" },
      { status: 400 },
    );
  }

  try {
    const result = await createLeadFromPhoneCall(parsed.data);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    console.error("[phone-routing/lead] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
