import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import {
  canViewSensitivePersonnel,
  getFieldGrants,
} from "@/lib/labor/permissions";
import { personnelDocumentTypeSchema } from "@/lib/validation/labor";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, saveFile } from "@/lib/files/storage";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string }> };

// W-9s and ID documents are sensitive: listing and uploading require the
// same gate as SSN reveal (ADMIN, or office roles with the grant).

export async function GET(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const grants = await getFieldGrants(session.user.id);
  if (!canViewSensitivePersonnel(session.user.role, grants)) return forbidden();

  const { id } = await context.params;
  const docs = await prisma.personnelDocument.findMany({
    where: { personnelId: id },
    select: {
      id: true,
      type: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      notes: true,
      createdAt: true,
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(docs);
}

export async function POST(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const grants = await getFieldGrants(session.user.id);
  if (!canViewSensitivePersonnel(session.user.role, grants)) return forbidden();

  const { id } = await context.params;
  const personnel = await prisma.personnel.findUnique({
    where: { id },
    select: { id: true, deletedAt: true },
  });
  if (!personnel || personnel.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const typeRaw = form.get("type");

  if (!(file instanceof File)) return badRequest("file is required");
  if (file.size === 0) return badRequest("file is empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    return badRequest(`file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return badRequest(`unsupported file type: ${file.type || "unknown"}`);
  }

  const typeParsed = personnelDocumentTypeSchema.safeParse(typeRaw ?? "OTHER");
  if (!typeParsed.success) return badRequest("invalid document type");

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await saveFile(buffer, file.name);

  const doc = await prisma.personnelDocument.create({
    data: {
      personnelId: id,
      type: typeParsed.data,
      fileName: file.name,
      fileType: file.type,
      fileSize: stored.bytes,
      storageKey: stored.storageKey,
      uploadedByUserId: session.user.id,
    },
    select: {
      id: true,
      type: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      createdAt: true,
    },
  });

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "PersonnelDocument",
    entityId: doc.id,
    action: "create",
    after: { personnelId: id, type: doc.type, fileName: doc.fileName },
  });

  return NextResponse.json(doc, { status: 201 });
}
