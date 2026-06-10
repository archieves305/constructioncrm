import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { parseBudget } from "@/lib/budget/parse";

const MAX_BYTES = 25 * 1024 * 1024;

// POST /api/jobs/[id]/budget/import — parse a .xlsx/.csv and REPLACE the job's
// budget lines. Existing lines are deleted (which clears expense/labor links
// via onDelete: SetNull); new lines are created.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0)
    return badRequest("No file uploaded");
  if (file.size > MAX_BYTES) return badRequest("File too large (max 25MB)");

  const name = file.name.toLowerCase();
  if (!/\.(xlsx|xls|csv)$/.test(name))
    return badRequest("Upload a .xlsx or .csv file");

  const job = await prisma.job.findUnique({ where: { id }, select: { id: true } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  let rows;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    rows = await parseBudget(buffer, file.name);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Could not read file");
  }
  if (rows.length === 0)
    return badRequest("No budget rows found. Expected columns: Category, Line item, Budget.");

  await prisma.$transaction([
    prisma.budgetLine.deleteMany({ where: { jobId: id } }),
    prisma.budgetLine.createMany({
      data: rows.map((r, i) => ({
        jobId: id,
        category: r.category,
        name: r.name,
        amount: r.amount,
        sortOrder: i,
      })),
    }),
  ]);

  const lines = await prisma.budgetLine.findMany({
    where: { jobId: id },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ count: lines.length, lines }, { status: 201 });
}
