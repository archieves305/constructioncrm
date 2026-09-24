import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/validation/body";
import { duplicateTemplateSchema } from "@/lib/validators/workflow";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { duplicateTemplate } from "@/lib/workflows/versioning";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { id } = await params;
  const parsed = await validateBody(request, duplicateTemplateSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await duplicateTemplate(id, parsed.data, a.user), { status: 201 });
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
