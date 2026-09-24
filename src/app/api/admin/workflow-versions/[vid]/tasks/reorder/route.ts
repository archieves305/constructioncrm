import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/validation/body";
import { reorderSchema } from "@/lib/validators/workflow";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { reorderTasks } from "@/lib/workflows/versioning";

export async function POST(request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { vid } = await params;
  const parsed = await validateBody(request, reorderSchema);
  if (!parsed.ok) return parsed.response;
  if (!parsed.data.phaseId) return NextResponse.json({ error: "phaseId is required" }, { status: 400 });
  try {
    await reorderTasks(vid, parsed.data.phaseId, parsed.data.ids, a.user);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
