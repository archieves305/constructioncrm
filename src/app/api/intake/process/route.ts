import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { processInboundEmails } from "@/lib/services/intake/intake-service";
import { OutlookInboxProvider } from "@/lib/services/intake/outlook-provider";

/**
 * POST /api/intake/process
 * Triggers email intake processing. Can be called manually or via cron.
 * Protected — requires admin/manager role.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const provider = new OutlookInboxProvider();
    const results = await processInboundEmails(provider);
    return NextResponse.json({ processed: results.length, results });
  } catch (err) {
    console.error("Intake processing error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 }
    );
  }
}
