import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { readFile } from "@/lib/files/storage";

type Context = { params: Promise<{ id: string }> };

// Streams the original photo bytes with the true MIME type. Uploads are
// client-downscaled (~2000px JPEG), so these double as their own thumbnails.
export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  const photo = await prisma.fieldPhoto.findUnique({
    where: { id },
    select: { jobId: true, storageKey: true, fileType: true, fileName: true },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await requireJobFieldAccess(photo.jobId, "read");
  if ("response" in ctx) return ctx.response;

  let buffer: Buffer;
  try {
    buffer = await readFile(photo.storageKey);
  } catch {
    return NextResponse.json({ error: "File missing from storage" }, { status: 410 });
  }

  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": photo.fileType,
      "Content-Disposition": `inline; filename="${photo.fileName.replace(/"/g, "")}"`,
      // Immutable content per id — safe to cache in the browser session.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
