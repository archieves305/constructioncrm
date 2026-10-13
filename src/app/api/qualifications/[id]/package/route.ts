import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { vaultViewerFor } from "@/lib/partners/grants";
import { buildPackage, previewPackage } from "@/lib/partners/package";
import { partnerErrorResponse } from "@/lib/partners/validation";

/**
 * The prequalification package for one GC. `?preview=1` answers what would
 * go in and why the rest would not (writes nothing); without it, the zip.
 * `?restricted=1` asks for RESTRICTED documents — honoured only for someone
 * who may open them, and each one is audited.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const includeRestricted = sp.get("restricted") === "1";
  const viewer = await vaultViewerFor(session.user);
  try {
    if (sp.get("preview") === "1") return NextResponse.json(await previewPackage(id, viewer, includeRestricted));
    const limited = enforceRateLimit(request, { name: "qualification-package", limit: 10, windowMs: 60_000, identifier: session.user.id });
    if (limited) return limited;
    const name = [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || session.user.email || "KNU";
    const { zip, fileName } = await buildPackage(id, { ...viewer, id: session.user.id, name }, includeRestricted, {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
    const ab = new ArrayBuffer(zip.byteLength);
    new Uint8Array(ab).set(zip);
    return new NextResponse(ab, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
