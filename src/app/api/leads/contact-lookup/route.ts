import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canWriteLeads } from "@/lib/access/roles";
import { leadAccessWhere } from "@/lib/access/records";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  // The lookup offers an existing customer's contact details: lead-writing roles
  // only, and an own-only role sees only the leads its lists show.
  if (!canWriteLeads(session.user.role)) return forbidden();

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
    where: { AND: [{ OR: orClauses }, leadAccessWhere(session.user)] },
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

  // People at Business Development accounts: a calling estimator resolves to
  // their company. Phones are stored as typed, so the database narrows on
  // the last four digits and the digits are compared here.
  const last10 = phoneDigits.slice(-10);
  const last4 = phoneDigits.slice(-4);
  const contactOr = [];
  if (phoneReady) contactOr.push({ phone: { contains: last4 } }, { mobile: { contains: last4 } });
  if (emailReady) contactOr.push({ email: { equals: emailRaw, mode: "insensitive" as const } });
  const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");
  const contacts = contactOr.length
    ? (
        await prisma.contact.findMany({
          where: { isActive: true, OR: contactOr },
          select: { id: true, firstName: true, lastName: true, title: true, email: true, phone: true, mobile: true, organization: { select: { id: true, name: true } } },
          take: 50,
        })
      )
        .filter((c) => (emailReady && c.email?.toLowerCase() === emailRaw) || (phoneReady && (digits(c.phone).endsWith(last10) || digits(c.mobile).endsWith(last10))))
        .slice(0, 5)
    : [];

  return NextResponse.json({ matches: Array.from(byKey.values()).slice(0, 5), contacts });
}
