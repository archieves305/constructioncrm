import { NextRequest, NextResponse } from "next/server";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { publishVersion } from "@/lib/workflows/versioning";

export async function POST(request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { vid } = await params;
  const body = (await request.json().catch(() => ({}))) as { changeNotes?: string | null };
  try {
    const v = await publishVersion(vid, a.user, typeof body.changeNotes === "string" ? body.changeNotes : null);
    return NextResponse.json({ id: v.id, version: v.version, status: v.status, publishedAt: v.publishedAt });
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
