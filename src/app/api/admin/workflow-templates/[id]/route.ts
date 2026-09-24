import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import { templateMetaPatchSchema } from "@/lib/validators/workflow";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { updateTemplateMeta } from "@/lib/workflows/versioning";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await templateActor("view");
  if ("response" in a) return a.response;
  const { id } = await params;
  const t = await prisma.workflowTemplate.findUnique({
    where: { id },
    include: {
      serviceCategories: { include: { serviceCategory: { select: { id: true, name: true } } } },
      versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, publishedAt: true, supersededAt: true, changeNotes: true, createdAt: true, _count: { select: { phases: true, tasks: true, modules: true } } } },
    },
  });
  if (!t) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ ...t, serviceCategories: t.serviceCategories.map((c) => c.serviceCategory) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { id } = await params;
  const parsed = await validateBody(request, templateMetaPatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await updateTemplateMeta(id, parsed.data, a.user));
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
