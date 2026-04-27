import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

function page(title: string, body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.06);padding:32px;max-width:440px;text-align:center}
h1{font-size:20px;margin:0 0 12px;color:#111827}
p{color:#374151;line-height:1.5;margin:0}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function unsubscribe(request: NextRequest): Promise<NextResponse> {
  const limited = enforceRateLimit(request, {
    name: "email.unsubscribe",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const token = request.nextUrl.searchParams.get("token");
  if (!token) return page("Invalid link", "This unsubscribe link is missing its token.", 400);

  const leadId = verifyUnsubscribeToken(token);
  if (!leadId) {
    return page("Invalid link", "This unsubscribe link is invalid or has been tampered with.", 400);
  }

  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { emailOptedOut: true, emailOptedOutAt: new Date() },
    });
  } catch (err) {
    logger.exception(err, { where: "email.unsubscribe", leadId });
    return page("Unsubscribe failed", "We couldn't process your request. Please contact us directly.", 500);
  }

  return page(
    "You've been unsubscribed",
    "You won't receive further automated emails from us. If this was a mistake, just reply to any prior message and we'll re-enable contact.",
  );
}

export async function GET(request: NextRequest) {
  return unsubscribe(request);
}

export async function POST(request: NextRequest) {
  return unsubscribe(request);
}
