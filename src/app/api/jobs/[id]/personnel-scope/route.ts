import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { jobPersonnelScopeSchema } from "@/lib/validation/labor";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { resolveWorkerScope } from "@/lib/labor/scope";

type Context = { params: Promise<{ id: string }> };

// Per-job pay basis / work description for the people on a job. Read gives
// the RESOLVED value (profile default merged with any override) so callers
// never re-implement the fallback.
export async function GET(_request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  const overrides = await prisma.jobPersonnelScope.findMany({
    where: { jobId },
    select: {
      personnelId: true,
      payType: true,
      workDescription: true,
      personnel: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          trade: true,
          payType: true,
          workDescription: true,
        },
      },
    },
    orderBy: [
      { personnel: { lastName: "asc" } },
      { personnel: { firstName: "asc" } },
    ],
  });

  return NextResponse.json(
    overrides.map((o) => ({
      personnelId: o.personnelId,
      personnel: {
        id: o.personnel.id,
        firstName: o.personnel.firstName,
        lastName: o.personnel.lastName,
        trade: o.personnel.trade,
      },
      profile: {
        payType: o.personnel.payType,
        workDescription: o.personnel.workDescription,
      },
      override: { payType: o.payType, workDescription: o.workDescription },
      resolved: resolveWorkerScope(o.personnel, o),
    })),
  );
}

// Upsert one worker's override for this job. Sending null for both columns
// deletes the row — "no override" and "an override of nothing" must not be
// two different states in the table.
export async function PUT(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const v = await validateBody(request, jobPersonnelScopeSchema);
  if (!v.ok) return v.response;
  const { personnelId, payType = null, workDescription = null } = v.data;

  const person = await prisma.personnel.findUnique({
    where: { id: personnelId },
    select: {
      id: true,
      payType: true,
      workDescription: true,
      deletedAt: true,
    },
  });
  if (!person || person.deletedAt) return badRequest("Unknown personnel");

  if (payType === null && workDescription === null) {
    await prisma.jobPersonnelScope.deleteMany({ where: { jobId, personnelId } });
    return NextResponse.json({
      personnelId,
      override: { payType: null, workDescription: null },
      resolved: resolveWorkerScope(person, null),
    });
  }

  const saved = await prisma.jobPersonnelScope.upsert({
    where: { jobId_personnelId: { jobId, personnelId } },
    create: {
      jobId,
      personnelId,
      payType,
      workDescription,
      createdByUserId: ctx.session.user.id,
    },
    update: { payType, workDescription },
    select: { payType: true, workDescription: true },
  });

  return NextResponse.json({
    personnelId,
    override: saved,
    resolved: resolveWorkerScope(person, saved),
  });
}
