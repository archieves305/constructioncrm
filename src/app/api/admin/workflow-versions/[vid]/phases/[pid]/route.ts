import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/validation/body";
import { phasePatchSchema } from "@/lib/validators/workflow";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { deletePhase, updatePhase } from "@/lib/workflows/versioning";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vid: string; pid: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { vid, pid } = await params;
  const parsed = await validateBody(request, phasePatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await updatePhase(vid, pid, parsed.data, a.user));
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ vid: string; pid: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { vid, pid } = await params;
  try {
    return NextResponse.json(await deletePhase(vid, pid, a.user));
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
