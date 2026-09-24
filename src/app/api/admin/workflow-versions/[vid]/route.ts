import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import { versionPatchSchema } from "@/lib/validators/workflow";
import { templateActor, versioningErrorResponse } from "@/lib/workflows/admin-route";
import { VERSION_TREE_INCLUDE, toComposeModule, loadPublishedVersion } from "@/lib/workflows/load";
import { setScopeToggles, requireDraft } from "@/lib/workflows/versioning";
import { CORE_MODULE_KEY } from "@/lib/workflows/keys";

/** The full tree for the editor, plus the Core step keys a trade may reference or override. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const a = await templateActor("view");
  if ("response" in a) return a.response;
  const { vid } = await params;
  const v = await prisma.workflowTemplateVersion.findUnique({ where: { id: vid }, include: VERSION_TREE_INCLUDE });
  if (!v) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const mod = toComposeModule(v);
  const core = v.template.kind === "CORE" ? null : await loadPublishedVersion(prisma, CORE_MODULE_KEY);
  const referenced = await prisma.jobWorkflowModule.count({ where: { templateVersionId: vid } });
  return NextResponse.json({
    id: v.id,
    version: v.version,
    status: v.status,
    changeNotes: v.changeNotes,
    publishedAt: v.publishedAt,
    template: v.template,
    scopeToggles: mod.definition.scopeToggles,
    phases: v.phases,
    tasks: v.tasks,
    dependencies: v.dependencies,
    referencedByJobs: referenced,
    coreSteps: core ? core.tasks.map((t) => ({ key: t.key, title: t.title })) : [],
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const a = await templateActor("manage");
  if ("response" in a) return a.response;
  const { vid } = await params;
  const parsed = await validateBody(request, versionPatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    await requireDraft(vid);
    if (parsed.data.scopeToggles !== undefined) await setScopeToggles(vid, parsed.data.scopeToggles, a.user);
    if (parsed.data.changeNotes !== undefined) await prisma.workflowTemplateVersion.update({ where: { id: vid }, data: { changeNotes: parsed.data.changeNotes } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return versioningErrorResponse(err) ?? Promise.reject(err);
  }
}
