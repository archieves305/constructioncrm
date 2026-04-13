import { NextRequest, NextResponse } from "next/server";

// Placeholder for inbound message webhook
export async function POST(request: NextRequest) {
  const body = await request.json();

  // TODO: Phase 2 - Parse inbound message from Twilio/provider
  // - Normalize payload
  // - Match to lead by phone number
  // - Store in communications table
  // - Trigger AI conversation handler if enabled

  console.log("Inbound webhook received:", body);

  return NextResponse.json({ received: true });
}
