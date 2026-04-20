import { prisma } from "@/lib/db/prisma";
import { addressMatches } from "./address-match";

export async function findMatchingJobs(
  poText: string | null | undefined,
): Promise<string[]> {
  if (!poText) return [];

  const jobs = await prisma.job.findMany({
    where: { currentStage: { isClosed: false } },
    select: {
      id: true,
      lead: { select: { propertyAddress1: true } },
    },
  });

  const hits: string[] = [];
  for (const job of jobs) {
    if (addressMatches(poText, job.lead.propertyAddress1)) {
      hits.push(job.id);
    }
  }
  return hits;
}
