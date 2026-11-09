import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import { canApproveJobCosts } from "@/lib/expenses/permissions";
import { canApproveLog } from "@/lib/labor/permissions";
import { canManageJobMoney } from "@/lib/money/access";

const street = (lead: { propertyAddress1: string; city: string } | null | undefined) => (lead ? [lead.propertyAddress1, lead.city].filter(Boolean).join(", ") : "Job");

/**
 * GET /api/mobile/approvals — what waits on the signed-in person, for the
 * phone's approvals inbox. Each list follows the rule of the route that
 * decides it: pending charges for canApproveJobCosts (decided at
 * /api/expenses/[id]/review), submitted daily logs for canApproveLog (decided
 * at …/daily-logs/[date]/approve and /return), crew submissions waiting, and
 * open crew payment requests for the money roles (paid at the desk).
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const role = session.user.role;
  const lead = { select: { propertyAddress1: true, city: true } } as const;
  const [expenses, logs, payRequests, crewWaiting] = await Promise.all([
    canApproveJobCosts(role)
      ? prisma.jobExpense.findMany({
          where: { status: "PENDING" },
          orderBy: { createdAt: "asc" },
          take: 50,
          select: { id: true, amount: true, vendor: true, description: true, type: true, incurredDate: true, job: { select: { id: true, jobNumber: true, lead } }, createdBy: { select: { firstName: true, lastName: true } }, _count: { select: { receipts: true } } },
        })
      : Promise.resolve([]),
    canApproveLog(role)
      ? prisma.dailyLog.findMany({
          where: { status: "SUBMITTED" },
          orderBy: { logDate: "asc" },
          take: 50,
          select: { id: true, logDate: true, submittedAt: true, workPerformed: true, job: { select: { id: true, jobNumber: true, lead } }, submittedBy: { select: { firstName: true, lastName: true } }, _count: { select: { laborEntries: true } } },
        })
      : Promise.resolve([]),
    canManageJobMoney(role)
      ? prisma.laborPaymentRequest.findMany({
          where: { status: "REQUESTED" },
          orderBy: { createdAt: "asc" },
          take: 50,
          select: { id: true, amount: true, neededBy: true, laborContract: { select: { label: true, crew: { select: { name: true } }, job: { select: { id: true, lead } } } } },
        })
      : Promise.resolve([]),
    canManageJobMoney(role) ? prisma.guestSubmission.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
  ]);
  return NextResponse.json({
    expenses: expenses.map((e) => ({
      id: e.id,
      amount: Number(e.amount),
      vendor: e.vendor,
      description: e.description,
      type: e.type,
      date: e.incurredDate.toISOString(),
      jobId: e.job.id,
      street: street(e.job.lead),
      enteredBy: `${e.createdBy.firstName} ${e.createdBy.lastName}`.trim(),
      receipts: e._count.receipts,
    })),
    logs: logs.map((l) => ({
      id: l.id,
      date: l.logDate.toISOString().slice(0, 10),
      jobId: l.job.id,
      street: street(l.job.lead),
      submittedBy: l.submittedBy ? `${l.submittedBy.firstName} ${l.submittedBy.lastName}`.trim() : null,
      submittedAt: l.submittedAt?.toISOString() ?? null,
      workPerformed: l.workPerformed?.slice(0, 280) ?? null,
      crewEntries: l._count.laborEntries,
    })),
    paymentRequests: payRequests.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      neededBy: r.neededBy?.toISOString() ?? null,
      crew: r.laborContract.crew?.name ?? r.laborContract.label ?? "Crew",
      jobId: r.laborContract.job.id,
      street: street(r.laborContract.job.lead),
    })),
    crewSubmissionsWaiting: crewWaiting,
  });
}
