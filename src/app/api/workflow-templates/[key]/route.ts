import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canViewTemplates } from "@/lib/workflows/access";
import { loadPublishedVersion, toComposeModule } from "@/lib/workflows/load";

/** The published version of one template as an outline: phases → tasks, with dependencies. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewTemplates(session.user.role)) return forbidden();
  const { key } = await params;

  const version = await loadPublishedVersion(prisma, key);
  if (!version) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  const mod = toComposeModule(version);
  const versions = await prisma.workflowTemplateVersion.findMany({
    where: { templateId: version.templateId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, publishedAt: true, changeNotes: true, _count: { select: { modules: true } } },
  });
  return NextResponse.json({
    template: version.template,
    version: { id: version.id, version: version.version, status: version.status, publishedAt: version.publishedAt },
    versions,
    scopeToggles: mod.definition.scopeToggles,
    phases: mod.definition.phases.map((p) => ({
      ...p,
      tasks: mod.definition.tasks.filter((t) => t.phaseKey === p.key),
    })),
    dependencies: mod.definition.dependencies,
  });
}
