import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { recordAudit } from "@/lib/audit/record";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canViewPartners } from "@/lib/partners/access";
import { getDocumentForDownload, readDocumentBytes } from "@/lib/partners/documents";
import { vaultViewerFor } from "@/lib/partners/grants";

/**
 * The bytes of a vault document — the only route that serves them. A document
 * the viewer may not open is a 404 (its existence is not confirmed); a
 * RESTRICTED read is audited with the caller's address. Decrypted on the way
 * out when the row says the file is encrypted. `?download=1` forces a save.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = enforceRateLimit(request, { name: "vault-download", limit: 60, windowMs: 60_000, identifier: session.user.id });
  if (limited) return limited;
  const { id } = await params;
  const viewer = await vaultViewerFor(session.user);
  const doc = await getDocumentForDownload(id, viewer);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await readDocumentBytes(doc);
  } catch {
    return NextResponse.json({ error: "The file is missing from storage" }, { status: 410 });
  }
  if (doc.confidentiality === "RESTRICTED") {
    await recordAudit({
      actorUserId: session.user.id,
      entityType: "CompanyDocument",
      entityId: doc.id,
      action: "document_view",
      after: { type: doc.documentType.key, title: doc.title, fileName: doc.fileName },
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
  }
  const download = request.nextUrl.searchParams.get("download") === "1";
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": doc.fileType || "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
