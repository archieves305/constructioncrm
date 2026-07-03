import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { personnelUpdateSchema } from "@/lib/validation/labor";
import {
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

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canReadPersonnel(session.user.role)) return forbidden();

  const { id } = await context.params;
  // Document metadata rides the same gate as document contents — fetched
  // only when the viewer could open them anyway.
  const grants = await getFieldGrants(session.user.id);
  const includeDocs = canViewSensitivePersonnel(session.user.role, grants);

  const row = await prisma.personnel.findUnique({
    where: { id },
    include: {
      crew: { select: { id: true, name: true } },
      ...(includeDocs
        ? {
            documents: {
              select: {
                id: true,
                type: true,
                fileName: true,
                fileType: true,
                fileSize: true,
                notes: true,
                createdAt: true,
                uploadedBy: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
              orderBy: { createdAt: "desc" as const },
            },
          }
        : {}),
    },
  });
  if (!row || row.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(serializePersonnel(row, session.user.role));
}

export async function PATCH(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePersonnel(session.user.role)) return forbidden();

  const { id } = await context.params;
  const existing = await prisma.personnel.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const v = await validateBody(request, personnelUpdateSchema);
  if (!v.ok) return v.response;
  const { ssn, hourlyRate, startDate, endDate, ...rest } = v.data;

  const grants = await getFieldGrants(session.user.id);

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) data[key] = value;
  }
  if (startDate !== undefined) {
    data.startDate = startDate ? new Date(`${startDate}T00:00:00Z`) : null;
  }
  if (endDate !== undefined) {
    data.endDate = endDate ? new Date(`${endDate}T00:00:00Z`) : null;
  }

  if (hourlyRate !== undefined) {
    if (!canEditPayRates(session.user.role, grants)) return forbidden();
    data.hourlyRate = hourlyRate;
  }

  let ssnChanged = false;
  if (ssn !== undefined) {
    if (!canViewSensitivePersonnel(session.user.role, grants)) return forbidden();
    if (ssn === null || ssn === "") {
      data.ssnCiphertext = null;
      data.ssnLast4 = null;
      data.ssnKeyVersion = null;
      ssnChanged = true;
    } else {
      if (!isFieldEncryptionConfigured()) {
        return NextResponse.json(
          { error: "Field encryption is not configured" },
          { status: 503 },
        );
      }
      const digits = normalizeSsn(ssn);
      if (!digits) return badRequest("SSN must be 9 digits");
      const { ciphertext, keyVersion } = encryptField(digits, `personnel:${id}`);
      data.ssnCiphertext = ciphertext;
      data.ssnLast4 = digits.slice(-4);
      data.ssnKeyVersion = keyVersion;
      ssnChanged = true;
    }
  }

  const updated = await prisma.personnel.update({
    where: { id },
    data,
    include: { crew: { select: { id: true, name: true } } },
  });

  if (hourlyRate !== undefined && String(existing.hourlyRate) !== String(updated.hourlyRate)) {
    await recordAudit({
      actorUserId: session.user.id,
      entityType: "Personnel",
      entityId: id,
      action: "rate_change",
      before: { hourlyRate: existing.hourlyRate },
      after: { hourlyRate: updated.hourlyRate },
    });
  }
  if (ssnChanged) {
    await recordAudit({
      actorUserId: session.user.id,
      entityType: "Personnel",
      entityId: id,
      action: "ssn_set",
      after: { last4: updated.ssnLast4 },
    });
  }

  return NextResponse.json(serializePersonnel(updated, session.user.role));
}

export async function DELETE(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePersonnel(session.user.role)) return forbidden();

  const { id } = await context.params;
  const hard = request.nextUrl.searchParams.get("hard") === "true";

  const existing = await prisma.personnel.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (hard) {
    // Hard delete: ADMIN only, and only when the person has no labor history
    // (the DailyLaborEntry FK is Restrict; today that means no dependents yet).
    if (session.user.role !== "ADMIN") return forbidden();
    await prisma.personnel.delete({ where: { id } });
  } else {
    await prisma.personnel.update({
      where: { id },
      data: { isActive: false, status: "INACTIVE", deletedAt: new Date() },
    });
  }

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "Personnel",
    entityId: id,
    action: hard ? "delete" : "deactivate",
    before: { name: `${existing.firstName} ${existing.lastName}` },
  });

  return NextResponse.json({ ok: true });
}
