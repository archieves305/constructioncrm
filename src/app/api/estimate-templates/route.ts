import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

// GET /api/estimate-templates
//   → list active templates (id, key, category, name, sortOrder) for the picker
// GET /api/estimate-templates?key=drywall  (or ?category=DRYWALL)
//   → a single template with ordered sections + line items, for builder preload
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const category = searchParams.get("category");

  if (key || category) {
    const template = await prisma.estimateTemplate.findFirst({
      where: {
        isActive: true,
        ...(key ? { key } : {}),
        ...(category ? { category: category as never } : {}),
      },
      include: {
        sections: {
          orderBy: { sortOrder: "asc" },
          include: {
            items: {
              where: { isActive: true },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(template);
  }

  const templates = await prisma.estimateTemplate.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, key: true, category: true, name: true, sortOrder: true },
  });
  return NextResponse.json(templates);
}
