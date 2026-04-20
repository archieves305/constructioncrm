-- CreateTable
CREATE TABLE "job_task_templates" (
    "id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "relative_due_in_days" INTEGER,
    "default_assigned_user_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_task_templates_stage_id_is_active_idx" ON "job_task_templates"("stage_id", "is_active");

-- AddForeignKey
ALTER TABLE "job_task_templates" ADD CONSTRAINT "job_task_templates_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "job_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_task_templates" ADD CONSTRAINT "job_task_templates_default_assigned_user_id_fkey" FOREIGN KEY ("default_assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
