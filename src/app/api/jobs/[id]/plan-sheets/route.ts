import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import { guardJob } from "@/lib/access/records";
import { crewFileCategories } from "@/lib/files/crew-visibility";

/**
 * GET /api/jobs/[id]/plan-sheets — the plan sheets on a job, for the phone's
 * Plans screen: the plan sets on the job (or on its lead with no job), each
 * sheet's number and title as indexed, and the image the phone opens (the
 * sheet render route, which applies the same rule). A crew lead gets them
 * only while plan sets are among the kinds of file crews may see.
 */
const CREW = ["CREW_LEAD", "CREW_MEMBER"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardJob(session.user, id, "read");
  if (denied) return denied;
  if (CREW.includes(session.user.role) && !(await crewFileCategories()).includes("PLAN_SET")) {
    return NextResponse.json({ error: "The office hasn't shared plans with crews." }, { status: 403 });
  }
  const job = await prisma.job.findUnique({ where: { id }, select: { leadId: true } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const sets = await prisma.planSet.findMany({
    where: { leadId: job.leadId, OR: [{ jobId: id }, { jobId: null }] },
    orderBy: { createdAt: "desc" },
    select: {
      name: true,
      documents: {
        orderBy: { sequence: "asc" },
        select: { sheets: { orderBy: { pageNumber: "asc" }, select: { id: true, sheetNumber: true, title: true, pageNumber: true, discipline: true } } },
      },
    },
  });
  const sheets = sets.flatMap((set) =>
    set.documents.flatMap((d) =>
      d.sheets.map((sh) => ({
        id: sh.id,
        sheetNumber: sh.sheetNumber,
        title: sh.title,
        pageNumber: sh.pageNumber,
        discipline: sh.discipline,
        setName: set.name,
        imageUrl: `/api/plan-sheets/${sh.id}/render?dpi=144`,
      })),
    ),
  );
  return NextResponse.json({ sheets });
}
