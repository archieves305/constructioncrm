import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyCcAllocatorAuth } from "@/lib/integrations/cc-allocator/auth";

// GET /api/integrations/cc-allocator/jobs?address=...
//
// Returns Jobs whose Lead's propertyAddress1 matches `address`
// (case-insensitive, trimmed). cc-allocator's drawer calls this when the
// user opens a transaction whose class maps to a Buildium property — the
// returned jobs are the picker options, ordered newest first.
//
// Match strategy is deliberately strict (equals, not LIKE): the user picks
// the job, so a too-fuzzy match buries the right answer in noise. If
// addresses don't line up, fix the source data — don't loosen the query.
export async function GET(request: NextRequest) {
  const authFail = verifyCcAllocatorAuth(request);
  if (authFail) return authFail;

  const address = request.nextUrl.searchParams.get("address")?.trim() || "";
  if (!address) {
    return NextResponse.json(
      { error: "address query parameter is required" },
      { status: 400 },
    );
  }

  const leads = await prisma.lead.findMany({
    where: {
      propertyAddress1: { equals: address, mode: "insensitive" },
    },
    select: {
      fullName: true,
      propertyAddress1: true,
      city: true,
      state: true,
      zipCode: true,
      jobs: {
        select: {
          id: true,
          jobNumber: true,
          title: true,
          createdAt: true,
          currentStage: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const matches = leads.flatMap((lead) =>
    lead.jobs.map((j) => ({
      jobId: j.id,
      jobNumber: j.jobNumber,
      jobName: j.title,
      stage: j.currentStage.name,
      leadName: lead.fullName,
      propertyAddress1: lead.propertyAddress1,
      city: lead.city,
      state: lead.state,
      zipCode: lead.zipCode,
      createdAt: j.createdAt.toISOString(),
    })),
  );

  return NextResponse.json(matches);
}
