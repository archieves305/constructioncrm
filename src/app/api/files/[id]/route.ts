import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { readFile, deleteFile } from "@/lib/files/storage";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = await readFile(file.storageKey).catch(() => null);
  if (!data) return NextResponse.json({ error: "Missing on disk" }, { status: 410 });

  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return new NextResponse(ab, {
    status: 200,
    headers: {
      "Content-Type": file.fileType || "application/octet-stream",
      "Content-Length": String(file.fileSize),
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deleteFile(file.storageKey);
  await prisma.file.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
