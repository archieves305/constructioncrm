import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/validation/body";
import { taskTemplateInputSchema } from "@/lib/validators/workflow";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { addTask } from "@/lib/workflows/versioning";

export async function POST(request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { vid } = await params;
  const parsed = await validateBody(request, taskTemplateInputSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await addTask(vid, parsed.data, a.user), { status: 201 });
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
