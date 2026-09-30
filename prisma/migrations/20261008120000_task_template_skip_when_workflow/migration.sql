-- AlterTable
ALTER TABLE "job_task_templates" ADD COLUMN     "skip_when_workflow" BOOLEAN NOT NULL DEFAULT false;

-- The stage-change tasks the streamlined workflow already carries as a step.
-- Matched by title; a renamed or missing row is simply left unticked, and
-- every tick is editable under Admin → Stage task templates.
UPDATE "job_task_templates" SET "skip_when_workflow" = true WHERE "title" IN (
  'Assign Project Manager to job',
  'Collect deposit',
  'Finalize scope & pricing',
  'Send final scope sheet for client sign-off',
  'Build materials order list',
  'Submit permit application',
  'Order materials',
  'Reserve crew & set tentative install date',
  'Confirm material delivery date',
  'Confirm crew + start date with client (24h prior)',
  'Walk-through with client',
  'Address punch-list items',
  'Schedule final city/county inspection',
  'Send final invoice to client',
  'Collect final payment'
);
