import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  getSession,
  unauthorized,
  forbidden,
  badRequest,
} from "@/lib/auth/helpers";
import { saveFile, deleteFile } from "@/lib/files/storage";
import { ensureBrandRow, KNU_BRAND_ID } from "@/lib/pdf/brand";

const ALLOWED_LOGO_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return forbidden();
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("file is required");
  if (file.size === 0) return badRequest("file is empty");
  if (file.size > MAX_LOGO_BYTES) {
    return badRequest(`logo exceeds ${MAX_LOGO_BYTES / 1024 / 1024}MB limit`);
  }
  if (!ALLOWED_LOGO_MIME.has(file.type)) {
    return badRequest(`unsupported logo type: ${file.type || "unknown"}`);
  }

  const existing = await ensureBrandRow(KNU_BRAND_ID, "Knu Construction");

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await saveFile(buffer, file.name);

  const updated = await prisma.roofingBrand.update({
    where: { id: KNU_BRAND_ID },
    data: { logoStorageKey: stored.storageKey },
  });

  if (existing.logoStorageKey && existing.logoStorageKey !== stored.storageKey) {
    await deleteFile(existing.logoStorageKey);
  }

  return NextResponse.json(updated, { status: 201 });
}

export async function DELETE() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return forbidden();
  }
  const existing = await ensureBrandRow(KNU_BRAND_ID, "Knu Construction");
  if (existing.logoStorageKey) {
    await deleteFile(existing.logoStorageKey);
  }
  const updated = await prisma.roofingBrand.update({
    where: { id: KNU_BRAND_ID },
    data: { logoStorageKey: null },
  });
  return NextResponse.json(updated);
}
