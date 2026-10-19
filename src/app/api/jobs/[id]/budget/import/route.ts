import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { parseBudget } from "@/lib/budget/parse";
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";
import { planBudgetImport } from "@/lib/budget/import-plan";
import { recordAudit } from "@/lib/audit/record";

const MAX_BYTES = 25 * 1024 * 1024;

// POST /api/jobs/[id]/budget/import — parse a .xlsx/.csv and make it the job's
// budget. A line still in the file keeps its row and its allocations; lines not
// in the file are removed; new ones are created (lib/budget/import-plan.ts).
// Audited.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });

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

  const before = await prisma.budgetLine.findMany({
    where: { jobId: id },
    select: { id: true, category: true, name: true, amount: true, _count: { select: { allocations: true } } },
  });
  const plan = planBudgetImport(
    before.map((l) => ({ id: l.id, category: l.category, name: l.name, amount: Number(l.amount) })),
    rows.map((r) => ({ category: r.category ?? null, name: r.name, amount: Number(r.amount) })),
  );
  await prisma.$transaction([
    ...plan.update.map((u) =>
      prisma.budgetLine.update({ where: { id: u.id }, data: { category: u.category, name: u.name, amount: u.amount, sortOrder: u.sortOrder } }),
    ),
    ...(plan.remove.length ? [prisma.budgetLine.deleteMany({ where: { id: { in: plan.remove } } })] : []),
    ...(plan.create.length
      ? [prisma.budgetLine.createMany({ data: plan.create.map((c) => ({ jobId: id, category: c.category, name: c.name, amount: c.amount, sortOrder: c.sortOrder })) })]
      : []),
  ]);
  const removedAllocations = before.filter((l) => plan.remove.includes(l.id)).reduce((n, l) => n + l._count.allocations, 0);
  await recordAudit({
    actorUserId: session.user.id,
    entityType: "job",
    entityId: id,
    action: "budget_import",
    before: { lines: before.length, total: before.reduce((s, l) => s + Number(l.amount), 0) },
    after: { file: file.name, kept: plan.update.length, created: plan.create.length, removed: plan.remove.length, removedAllocations, total: rows.reduce((s, r) => s + Number(r.amount), 0) },
  });

  const lines = await prisma.budgetLine.findMany({
    where: { jobId: id },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ count: lines.length, lines, kept: plan.update.length, created: plan.create.length, removed: plan.remove.length, removedAllocations }, { status: 201 });
}
