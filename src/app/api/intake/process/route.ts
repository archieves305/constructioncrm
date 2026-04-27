import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { processInboundEmails } from "@/lib/services/intake/intake-service";
import { OutlookInboxProvider } from "@/lib/services/intake/outlook-provider";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, {
    name: "intake.process",
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

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
    logger.exception(err, { where: "intake.process" });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 }
    );
  }
}
