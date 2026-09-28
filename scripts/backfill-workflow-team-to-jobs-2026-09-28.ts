/**
 * One-off: the Workflow tab's Team dialog named a project manager (and on
 * one job a sales rep) in the workflow slot only, so the job page's Team
 * card showed "PM: —". From 2026-09-28 the route mirrors those slots into
 * `Job.projectManagerId` / `Job.salesRepId`; this copies the slots already
 * on file through the same `mirrorTeamToJob` (activity + audit per job,
 * attributed to Richard). Slots that already match change nothing.
 *
 *   npx tsx scripts/backfill-workflow-team-to-jobs-2026-09-28.ts          # dry run
 *   npx tsx scripts/backfill-workflow-team-to-jobs-2026-09-28.ts --yes    # apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { jobFieldsFromTeam, mirrorTeamToJob } from "../src/lib/workflows/team-mirror";

const ACTOR_EMAIL = "richard@rcareylaw.com";

async function main() {
  const apply = process.argv.includes("--yes");
  const actor = await prisma.user.findUniqueOrThrow({ where: { email: ACTOR_EMAIL }, select: { id: true } });
  const instances = await prisma.jobWorkflowInstance.findMany({
    where: { team: { some: { role: { in: ["PROJECT_MANAGER", "SALES_REP"] } } } },
    select: {
      job: { select: { id: true, jobNumber: true, projectManagerId: true, salesRepId: true } },
      team: { where: { role: { in: ["PROJECT_MANAGER", "SALES_REP"] } }, select: { role: true, userId: true } },
    },
  });

  let changed = 0;
  for (const inst of instances) {
    if (!inst.job) continue;
    const team = Object.fromEntries(inst.team.map((t) => [t.role, t.userId]));
    const diff = jobFieldsFromTeam(team, inst.job);
    if (Object.keys(diff).length === 0) {
      console.log(`${inst.job.jobNumber}: unchanged`);
      continue;
    }
    changed += 1;
    if (apply) {
      const result = await mirrorTeamToJob({ jobId: inst.job.id, team, actorUserId: actor.id });
      console.log(`${inst.job.jobNumber}: applied ${JSON.stringify(result)}`);
    } else {
      console.log(`${inst.job.jobNumber}: would set ${JSON.stringify(diff)}`);
    }
  }
  console.log(`${apply ? "applied" : "would change"} ${changed} of ${instances.length} jobs with a PM/sales slot`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
