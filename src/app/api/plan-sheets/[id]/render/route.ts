import { promises as fs } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { badRequest, getSession, unauthorized } from "@/lib/auth/helpers";
import { guardSheet } from "@/lib/takeoff/route-guards";
import { renderPathFor } from "@/lib/takeoff/sheet-cache";

/**
 * The sheet as a PNG at 72 or 144 dpi, rendered on first request and kept
 * beside the document. Same-origin, so the viewer's `<img>` is allowed by the
 * site's CSP without any change.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardSheet(session.user, id, "read");
  if (denied) return denied;
  const dpiRaw = request.nextUrl.searchParams.get("dpi") ?? "72";
  if (dpiRaw !== "72" && dpiRaw !== "144") return badRequest("dpi must be 72 or 144");
  const dpi = Number(dpiRaw) as 72 | 144;
  const path = await renderPathFor(id, dpi);
  if (!path) return NextResponse.json({ error: "This sheet has no render yet" }, { status: 404 });
  const data = await fs.readFile(path).catch(() => null);
  if (!data) return NextResponse.json({ error: "The render is missing on disk" }, { status: 410 });
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return new NextResponse(ab, { status: 200, headers: { "Content-Type": "image/png", "Content-Length": String(data.byteLength), "Cache-Control": "private, max-age=86400" } });
}
