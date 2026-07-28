import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { personnelCreateSchema } from "@/lib/validation/labor";
import {
  canCreatePersonnel,
  canEditPayRates,
  canManagePersonnel,
  canReadPersonnel,
  canViewSensitivePersonnel,
  getFieldGrants,
} from "@/lib/labor/permissions";
import { serializePersonnel } from "@/lib/labor/serialize";
import {
  encryptField,
  isFieldEncryptionConfigured,
  normalizeSsn,
} from "@/lib/crypto/field-encryption";
import { recordAudit } from "@/lib/audit/record";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canReadPersonnel(session.user.role)) return forbidden();

  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q")?.trim() || "";
  const crewId = searchParams.get("crewId") || undefined;
  const trade = searchParams.get("trade")?.trim() || "";
  const employmentType = searchParams.get("employmentType") || undefined;
  const payType = searchParams.get("payType") || undefined;
  const activeOnly = searchParams.get("activeOnly") === "true";

  const where: Record<string, unknown> = { deletedAt: null };
  if (activeOnly) where.isActive = true;
  if (crewId) where.crewId = crewId;
  if (employmentType) where.employmentType = employmentType;
  if (payType) where.payType = payType;
  if (trade) where.trade = { contains: trade, mode: "insensitive" };
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { entityName: { contains: q, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.personnel.findMany({
    where,
    include: { crew: { select: { id: true, name: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json(
    rows.map((r) => serializePersonnel(r, session.user.role)),
  );
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canCreatePersonnel(session.user.role)) return forbidden();

  const v = await validateBody(request, personnelCreateSchema);
  if (!v.ok) return v.response;
  const { ssn: ssnInput, hourlyRate: rateInput, startDate, endDate, ...rest } = v.data;
  let ssn = ssnInput;
  let hourlyRate = rateInput;

  // Field creates are roster-level only: a crew lead adding a walk-on worker
  // supplies identity/trade/crew; contact details beyond phone, rates, and
  // SSNs stay with the office. Extra fields are dropped, not 403'd, so the
  // client stays simple.
  if (!canManagePersonnel(session.user.role)) {
    const FIELD_CREATE_KEYS = new Set([
      "firstName",
      "lastName",
      "phone",
      "trade",
      "crewId",
      "employmentType",
      // A crew lead signing on a walk-on worker is exactly who knows the
      // pay basis and the scope of work; neither field exposes an amount.
      "payType",
      "workDescription",
    ]);
    for (const key of Object.keys(rest)) {
      if (!FIELD_CREATE_KEYS.has(key)) {
        delete (rest as Record<string, unknown>)[key];
      }
    }
    ssn = null;
    hourlyRate = null;
  }

  const grants = await getFieldGrants(session.user.id);

  if (hourlyRate != null && !canEditPayRates(session.user.role, grants)) {
    return forbidden();
  }
  if (ssn != null && ssn !== "") {
    if (!canViewSensitivePersonnel(session.user.role, grants)) return forbidden();
    if (!isFieldEncryptionConfigured()) {
      return NextResponse.json(
        { error: "Field encryption is not configured" },
        { status: 503 },
      );
    }
    if (!normalizeSsn(ssn)) return badRequest("SSN must be 9 digits");
  }

  // Create first, then encrypt in the same transaction: the AAD binds the
  // ciphertext to the row id, which doesn't exist until the insert.
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.personnel.create({
      data: {
        ...rest,
        hourlyRate: hourlyRate ?? null,
        startDate: startDate ? new Date(`${startDate}T00:00:00Z`) : null,
        endDate: endDate ? new Date(`${endDate}T00:00:00Z`) : null,
        createdByUserId: session.user.id,
      },
    });
    if (ssn) {
      const digits = normalizeSsn(ssn)!;
      const { ciphertext, keyVersion } = encryptField(digits, `personnel:${row.id}`);
      return tx.personnel.update({
        where: { id: row.id },
        data: {
          ssnCiphertext: ciphertext,
          ssnLast4: digits.slice(-4),
          ssnKeyVersion: keyVersion,
        },
        include: { crew: { select: { id: true, name: true } } },
      });
    }
    return tx.personnel.findUniqueOrThrow({
      where: { id: row.id },
      include: { crew: { select: { id: true, name: true } } },
    });
  });

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "Personnel",
    entityId: created.id,
    action: "create",
    after: {
      name: `${created.firstName} ${created.lastName}`,
      employmentType: created.employmentType,
      payType: created.payType,
      ssnSet: Boolean(created.ssnLast4),
    },
  });

  return NextResponse.json(serializePersonnel(created, session.user.role), {
    status: 201,
  });
}
