import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import { templateMetaSchema } from "@/lib/validators/workflow";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { createTemplate } from "@/lib/workflows/versioning";

/** Every template (any status) with its versions — the editor's library view. */
export async function GET() {
  const a = await templateActor("view");
  if ("response" in a) return a.response;
  const rows = await prisma.workflowTemplate.findMany({
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: {
      serviceCategories: { include: { serviceCategory: { select: { id: true, name: true } } } },
      versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, publishedAt: true, changeNotes: true, _count: { select: { phases: true, tasks: true, modules: true } } } },
    },
  });
  return NextResponse.json(rows.map((t) => ({ ...t, serviceCategories: t.serviceCategories.map((c) => c.serviceCategory) })));
}

export async function POST(request: NextRequest) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const parsed = await validateBody(request, templateMetaSchema);
  if (!parsed.ok) return parsed.response;
  if (!parsed.data.key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  try {
    const t = await createTemplate({ ...parsed.data, key: parsed.data.key }, a.user);
    return NextResponse.json(t, { status: 201 });
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
