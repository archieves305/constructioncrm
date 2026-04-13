import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const stages = await prisma.jobStage.findMany({ orderBy: { stageOrder: "asc" } });
  return NextResponse.json(stages);
}
