import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const phoneRaw = searchParams.get("phone")?.trim() || "";
  const emailRaw = searchParams.get("email")?.trim().toLowerCase() || "";

  const phoneDigits = phoneRaw.replace(/\D/g, "");
  const phoneReady = phoneDigits.length >= 10;
  const emailReady = emailRaw.includes("@") && emailRaw.includes(".");

  if (!phoneReady && !emailReady) {
    return NextResponse.json({ matches: [] });
  }

  const orClauses = [];
  if (phoneReady) {
    orClauses.push({ primaryPhone: phoneRaw });
    if (phoneRaw !== phoneDigits) orClauses.push({ primaryPhone: phoneDigits });
  }
  if (emailReady) {
    orClauses.push({ email: { equals: emailRaw, mode: "insensitive" as const } });
  }

  const leads = await prisma.lead.findMany({
    where: { OR: orClauses },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
      email: true,
      primaryPhone: true,
      secondaryPhone: true,
      companyName: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const byKey = new Map<
    string,
    {
      firstName: string;
      lastName: string;
      email: string | null;
      primaryPhone: string;
      secondaryPhone: string | null;
      companyName: string | null;
      leadCount: number;
      latestLeadId: string;
    }
  >();

  for (const l of leads) {
    const key = [
      l.primaryPhone.replace(/\D/g, ""),
      (l.email || "").toLowerCase(),
      l.fullName.toLowerCase().trim(),
    ].join("|");

    const existing = byKey.get(key);
    if (existing) {
      existing.leadCount += 1;
      continue;
    }
    byKey.set(key, {
      firstName: l.firstName,
      lastName: l.lastName,
      email: l.email,
      primaryPhone: l.primaryPhone,
      secondaryPhone: l.secondaryPhone,
      companyName: l.companyName,
      leadCount: 1,
      latestLeadId: l.id,
    });
  }

  return NextResponse.json({ matches: Array.from(byKey.values()).slice(0, 5) });
}
