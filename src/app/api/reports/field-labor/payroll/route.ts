import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { canViewPayroll, getFieldGrants } from "@/lib/labor/permissions";
import { isIsoDate } from "@/lib/labor/dates";
import { validateBody } from "@/lib/validation/body";
import {
  PayrollRunError,
  getPayrollWeek,
  markWeekPaid,
  unmarkWeekPaid,
} from "@/lib/labor/payroll-run";

// Weekly payroll run: who should be paid, mark a worker's week PAID (posts
// LABOR expenses on the jobs worked), and admin undo.

async function requirePayrollAccess() {
  const session = await getSession();
  if (!session?.user) return { response: unauthorized() };
  const grants = await getFieldGrants(session.user.id);
  if (!canViewPayroll(session.user.role, grants)) return { response: forbidden() };
  return { session };
}

export async function GET(request: NextRequest) {
  const auth = await requirePayrollAccess();
  if ("response" in auth) return auth.response;

  const weekStart = request.nextUrl.searchParams.get("weekStart");
  if (!weekStart || !isIsoDate(weekStart)) {
    return badRequest("weekStart is required (YYYY-MM-DD)");
  }
  return NextResponse.json(await getPayrollWeek(weekStart));
}

const paySchema = z.object({
  weekStart: z.string().refine(isIsoDate, "Expected YYYY-MM-DD"),
  personnelId: z.string().min(1),
  method: z
    .enum(["CHECK", "CARD", "ACH", "CASH", "FINANCING", "WIRE", "OTHER"])
    .nullish(),
  reference: z.string().trim().max(200).nullish(),
});

export async function POST(request: NextRequest) {
  const auth = await requirePayrollAccess();
  if ("response" in auth) return auth.response;

  const v = await validateBody(request, paySchema);
  if (!v.ok) return v.response;

  try {
    const result = await markWeekPaid({
      weekStart: v.data.weekStart,
      personnelId: v.data.personnelId,
      method: v.data.method ?? null,
      reference: v.data.reference ?? null,
      userId: auth.session.user.id,
    });
    return NextResponse.json({
      ok: true,
      paymentId: result.payment.id,
      gross: result.gross,
      jobs: result.byJob,
    });
  } catch (err) {
    if (err instanceof PayrollRunError) return badRequest(err.message);
    // Unique (personnelId, weekStart) race — treat as already paid.
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("This week was already marked paid");
    }
    throw err;
  }
}

const unpaySchema = z.object({
  weekStart: z.string().refine(isIsoDate, "Expected YYYY-MM-DD"),
  personnelId: z.string().min(1),
});

export async function DELETE(request: NextRequest) {
  const auth = await requirePayrollAccess();
  if ("response" in auth) return auth.response;
  if (auth.session.user.role !== "ADMIN") {
    return forbidden();
  }

  const v = await validateBody(request, unpaySchema);
  if (!v.ok) return v.response;

  try {
    await unmarkWeekPaid({
      weekStart: v.data.weekStart,
      personnelId: v.data.personnelId,
      userId: auth.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PayrollRunError) return badRequest(err.message);
    throw err;
  }
}
