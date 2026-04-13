import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

/**
 * GET /api/intake — List inbound email events for monitoring
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || undefined;
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "50");

  const where: Record<string, unknown> = {};
  if (status) where.processingStatus = status;

  const [data, total] = await Promise.all([
    prisma.inboundEmailEvent.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.inboundEmailEvent.count({ where }),
  ]);

  return NextResponse.json({ data, total, page, pageSize });
}
