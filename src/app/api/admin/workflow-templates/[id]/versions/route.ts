import { NextRequest, NextResponse } from "next/server";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { createDraft } from "@/lib/workflows/versioning";

/** Start a new DRAFT from the published version (or `?from=<versionId>`). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { id } = await params;
  const from = request.nextUrl.searchParams.get("from") ?? undefined;
  try {
    return NextResponse.json(await createDraft(id, a.user, from), { status: 201 });
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
