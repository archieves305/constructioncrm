import { NextRequest, NextResponse } from "next/server";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { archiveVersion } from "@/lib/workflows/versioning";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { vid } = await params;
  try {
    const v = await archiveVersion(vid, a.user);
    return NextResponse.json({ id: v.id, version: v.version, status: v.status });
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
