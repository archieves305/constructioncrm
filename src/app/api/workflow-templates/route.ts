import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { readScopeToggles } from "@/lib/workflows/load";

/**
 * Published workflow templates, for the Apply dialog and the library page.
 * `?suggestForJobId=` marks the trades whose service categories match the
 * job's lead services ("Roofing, Windows" → Roofing + Doors & Windows).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const suggestFor = request.nextUrl.searchParams.get("suggestForJobId");
  const serviceNames = new Set<string>();
  if (suggestFor) {
    const job = await prisma.job.findUnique({ where: { id: suggestFor }, select: { serviceType: true } });
    for (const s of (job?.serviceType ?? "").split(",")) if (s.trim()) serviceNames.add(s.trim().toLowerCase());
  }

  const templates = await prisma.workflowTemplate.findMany({
    where: { isActive: true, versions: { some: { status: "PUBLISHED" } } },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: {
      serviceCategories: { include: { serviceCategory: { select: { name: true } } } },
      versions: {
        where: { status: "PUBLISHED" },
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          version: true,
          scopeToggles: true,
          publishedAt: true,
          _count: { select: { phases: true, tasks: true } },
          // For the jobs-list Phase filter: full keys the tasks carry.
          phases: { orderBy: { sortOrder: "asc" }, select: { key: true, name: true, band: true } },
        },
      },
    },
  });

  return NextResponse.json(
    templates
      .filter((t) => t.versions.length > 0)
      .map((t) => {
        const v = t.versions[0]!;
        const categories = t.serviceCategories.map((c) => c.serviceCategory.name);
        return {
          id: t.id,
          key: t.key,
          name: t.name,
          kind: t.kind,
          trade: t.trade,
          description: t.description,
          version: v.version,
          versionId: v.id,
          publishedAt: v.publishedAt,
          phaseCount: v._count.phases,
          taskCount: v._count.tasks,
          scopeToggles: readScopeToggles(v.scopeToggles),
          phases: v.phases.map((p) => ({ key: `${t.key}:${p.key}`, shortKey: p.key, name: p.name, band: p.band })),
          serviceCategoryNames: categories,
          suggested: t.kind === "TRADE" && categories.some((c) => serviceNames.has(c.toLowerCase())),
        };
      }),
  );
}
