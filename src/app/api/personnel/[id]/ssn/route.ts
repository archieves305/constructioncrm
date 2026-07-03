import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import {
  canViewSensitivePersonnel,
  getFieldGrants,
} from "@/lib/labor/permissions";
import {
  decryptField,
  isFieldEncryptionConfigured,
} from "@/lib/crypto/field-encryption";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";

type Context = { params: Promise<{ id: string }> };

// Reveal a personnel record's full SSN. Strictly gated (ADMIN, or
// MANAGER/OFFICE_STAFF holding the canViewSensitivePersonnel grant, checked
// fresh from the DB) and audited BEFORE the value is returned.
export async function GET(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const grants = await getFieldGrants(session.user.id);
  if (!canViewSensitivePersonnel(session.user.role, grants)) return forbidden();

  if (!isFieldEncryptionConfigured()) {
    return NextResponse.json(
      { error: "Field encryption is not configured" },
      { status: 503 },
    );
  }

  const { id } = await context.params;
  const row = await prisma.personnel.findUnique({
    where: { id },
    select: { id: true, ssnCiphertext: true, ssnLast4: true, deletedAt: true },
  });
  if (!row || row.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!row.ssnCiphertext) {
    return NextResponse.json({ error: "No SSN on file" }, { status: 404 });
  }

  let ssn: string;
  try {
    ssn = decryptField(row.ssnCiphertext, `personnel:${id}`);
  } catch (err) {
    logger.exception(err, { where: "personnel.ssn.reveal", personnelId: id });
    return NextResponse.json(
      { error: "Unable to decrypt — key missing or data corrupted" },
      { status: 500 },
    );
  }

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "Personnel",
    entityId: id,
    action: "ssn_view",
    after: { last4: row.ssnLast4 },
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json(
    { ssn },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
