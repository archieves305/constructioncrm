import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";
import { parseDueAt } from "@/lib/tasks/dates";
import { createOwnedProject } from "@/lib/jobs/owned-project";

const amount = z.number().finite().min(0).max(100_000_000);

const schema = z.object({
  purpose: z.enum(["FLIP", "RENTAL"]),
  propertyAddress1: z.string().trim().min(1, "Street address is required").max(200),
  propertyAddress2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(1, "City is required").max(100),
  state: z.string().trim().min(2).max(2).optional(),
  zipCode: z.string().trim().min(3, "ZIP is required").max(10),
  title: z.string().trim().max(200).nullish(),
  projectManagerId: z.string().min(1).nullish(),
  purchasePrice: amount.nullish(),
  afterRepairValue: amount.nullish(),
  monthlyRent: amount.nullish(),
  targetStartDate: z.string().nullish(),
  budgetTotal: amount.nullish(),
  budgetLines: z
    .array(z.object({ name: z.string().trim().min(1).max(200), category: z.string().trim().max(100).nullish(), amount }))
    .max(200)
    .optional(),
});

/** Start one of our own projects (a flip or a rental): the property record, the job, its budget and workflow. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });

  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const b = v.data;

  let targetStartDate: Date | null = null;
  if (b.targetStartDate) {
    targetStartDate = parseDueAt(b.targetStartDate);
    if (Number.isNaN(targetStartDate.getTime())) return NextResponse.json({ error: "targetStartDate must be a date" }, { status: 400 });
  }

  const job = await createOwnedProject(
    {
      purpose: b.purpose,
      propertyAddress1: b.propertyAddress1,
      propertyAddress2: b.propertyAddress2 ?? null,
      city: b.city,
      state: b.state,
      zipCode: b.zipCode,
      title: b.title ?? null,
      projectManagerId: b.projectManagerId ?? null,
      purchasePrice: b.purchasePrice ?? null,
      afterRepairValue: b.afterRepairValue ?? null,
      monthlyRent: b.monthlyRent ?? null,
      targetStartDate,
      budgetTotal: b.budgetTotal ?? null,
      budgetLines: b.budgetLines?.map((l) => ({ name: l.name, category: l.category ?? null, amount: l.amount })),
    },
    { id: session.user.id, role: session.user.role },
  );
  return NextResponse.json(job, { status: 201 });
}
