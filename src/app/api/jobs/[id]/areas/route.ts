import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { jobAreaSchema } from "@/lib/validation/labor";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  const activeOnly = request.nextUrl.searchParams.get("activeOnly") === "true";
  const areas = await prisma.jobArea.findMany({
    where: { jobId, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(areas);
}

// Field users can add areas on the fly ("Room 214" mid-shift), so write
// access to the job's field data is the gate — not an office role.
export async function POST(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const v = await validateBody(request, jobAreaSchema);
  if (!v.ok) return v.response;

  const existing = await prisma.jobArea.findUnique({
    where: { jobId_name: { jobId, name: v.data.name } },
  });
  if (existing) return badRequest(`Area "${v.data.name}" already exists on this job`);

  const area = await prisma.jobArea.create({
    data: { jobId, ...v.data },
  });
  return NextResponse.json(area, { status: 201 });
}
