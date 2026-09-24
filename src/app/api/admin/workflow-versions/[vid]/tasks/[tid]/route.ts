import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/validation/body";
import { taskTemplatePatchSchema } from "@/lib/validators/workflow";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { deleteTaskTemplate, updateTaskTemplate } from "@/lib/workflows/versioning";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vid: string; tid: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { vid, tid } = await params;
  const parsed = await validateBody(request, taskTemplatePatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await updateTaskTemplate(vid, tid, parsed.data, a.user));
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ vid: string; tid: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { vid, tid } = await params;
  try {
    return NextResponse.json(await deleteTaskTemplate(vid, tid, a.user));
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
