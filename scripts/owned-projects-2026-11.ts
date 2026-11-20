/**
 * Put the owned projects that already exist on their own footing (2026-11-20).
 *
 * Before this, an owned rehab (jobType OWNED_REHAB) started as a client job:
 * a 50 % deposit, "Deposit Needed", "Collect deposit", and the workflow's
 * deposit / final-invoice / final-payment steps, which it can never satisfy.
 * The migration gave each one a purpose (RENTAL when it was marked a rental
 * turnover, else FLIP). This, per owned job:
 *
 *  - clears the deposit it will never collect,
 *  - moves it from a client-only stage to the matching stage of its own list
 *    (Deposit Needed → Planning, Final Payment Due → Listed / Ready to Rent),
 *  - stands down its open customer workflow steps (an ordinary updateTask,
 *    reason "Workflow: one of our own projects — no customer").
 *
 * The purpose is printed so Richard can correct a rental read as a flip on the
 * job's Pricing card. Dry run by default; `--yes` applies. Idempotent.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { jobKindOf, mapStageToKind, NEXT_ACTION, stageFitsKind } from "../src/lib/jobs/stage-kinds";
import { CUSTOMER_STEP_KEYS, skipCustomerSteps } from "../src/lib/jobs/owned-project";
import { CORE_MODULE_KEY } from "../src/lib/workflows/keys";

async function main() {
  const apply = process.argv.includes("--yes");
  const actor = await prisma.user.findFirst({
    where: { role: { name: "ADMIN" }, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: { select: { name: true } } },
  });
  if (!actor) throw new Error("No active admin to record the changes under");

  const stages = await prisma.jobStage.findMany({ select: { id: true, name: true, stageOrder: true, kinds: true } });
  if (!stages.some((s) => s.name === "Planning")) throw new Error("The owned-projects migration has not run (no Planning stage)");

  const jobs = await prisma.job.findMany({
    where: { jobType: "OWNED_REHAB" },
    orderBy: { jobNumber: "asc" },
    select: {
      id: true,
      jobNumber: true,
      title: true,
      ownedPurpose: true,
      isRentalTurnover: true,
      depositRequired: true,
      currentStage: { select: { id: true, name: true, stageOrder: true, kinds: true } },
      workflow: { select: { id: true } },
    },
  });

  console.log(`${apply ? "APPLYING" : "DRY RUN — nothing will be written"} · ${jobs.length} owned projects\n`);
  let changed = 0;
  for (const job of jobs) {
    const kind = jobKindOf({ jobType: "OWNED_REHAB", ownedPurpose: job.ownedPurpose });
    const moveTo = stageFitsKind(job.currentStage, kind) ? null : mapStageToKind(stages, job.currentStage, kind);
    const clearDeposit = Number(job.depositRequired) > 0;
    const openSteps = job.workflow
      ? await prisma.task.count({
          where: {
            workflowInstanceId: job.workflow.id,
            workflowTaskKey: { in: CUSTOMER_STEP_KEYS.map((k) => `${CORE_MODULE_KEY}:${k}`) },
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
        })
      : 0;

    const notes = [
      `${kind === "RENTAL" ? "rental" : "flip"}${job.isRentalTurnover ? " (marked a rental turnover)" : ""}`,
      moveTo ? `stage ${job.currentStage.name} → ${moveTo.name}` : `stage ${job.currentStage.name} (fits)`,
      clearDeposit ? `deposit $${Number(job.depositRequired).toLocaleString()} → $0` : null,
      openSteps ? `${openSteps} customer step${openSteps === 1 ? "" : "s"} stood down` : null,
    ].filter(Boolean);
    console.log(`${job.jobNumber}  ${job.title.slice(0, 50).padEnd(50)}  ${notes.join(" · ")}`);
    if (!moveTo && !clearDeposit && !openSteps) continue;
    changed++;
    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: job.id },
        data: {
          ...(clearDeposit ? { depositRequired: 0 } : {}),
          ...(moveTo ? { currentStageId: moveTo.id, nextAction: NEXT_ACTION[moveTo.name] || null } : {}),
        },
      });
      if (moveTo) {
        await tx.jobStageHistory.create({
          data: { jobId: job.id, fromStageId: job.currentStage.id, toStageId: moveTo.id, changedByUserId: actor.id, reason: "Owned projects get their own stages" },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorUserId: actor.id,
          entityType: "Job",
          entityId: job.id,
          action: "owned_project_backfill",
          beforeJson: { stage: job.currentStage.name, depositRequired: Number(job.depositRequired) },
          afterJson: { kind, stage: moveTo?.name ?? job.currentStage.name, depositRequired: clearDeposit ? 0 : Number(job.depositRequired), customerStepsStoodDown: openSteps },
        },
      });
    });
    if (job.workflow && openSteps) await skipCustomerSteps(job.workflow.id, { id: actor.id, role: actor.role.name });
  }
  console.log(apply ? `\nUpdated ${changed}.` : `\nDry run — ${changed} would change. Re-run with --yes to apply.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
