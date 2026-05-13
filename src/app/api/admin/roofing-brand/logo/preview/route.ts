import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { readFile } from "@/lib/files/storage";
import path from "node:path";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const brand = await prisma.roofingBrand.findUnique({
    where: { id: "default" },
    select: { logoStorageKey: true },
  });
  if (!brand?.logoStorageKey) {
    return NextResponse.json({ error: "No logo configured" }, { status: 404 });
  }

  const buffer = await readFile(brand.logoStorageKey);
  const ext = path.extname(brand.logoStorageKey).toLowerCase();
  const contentType =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : "image/png";
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
