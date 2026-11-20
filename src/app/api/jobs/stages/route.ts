import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { JOB_KINDS, type JobKind } from "@/lib/jobs/stage-kinds";

/** Every job stage, or with `?kind=CLIENT|FLIP|RENTAL` only the stages that kind of job uses. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const kind = request.nextUrl.searchParams.get("kind");
  if (kind && !JOB_KINDS.includes(kind as JobKind)) return badRequest("kind must be CLIENT, FLIP or RENTAL");

  const stages = await prisma.jobStage.findMany({
    where: kind ? { kinds: { has: kind as JobKind } } : undefined,
    orderBy: [{ stageOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(stages);
}
