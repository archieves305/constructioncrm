-- CreateEnum
CREATE TYPE "FieldPhotoCategory" AS ENUM ('PROGRESS', 'BEFORE', 'AFTER', 'ISSUE', 'DAMAGE', 'SAFETY', 'MATERIAL_DELIVERY', 'INSPECTION', 'CHANGE_ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "FieldIssueType" AS ENUM ('OFFICE_FOLLOW_UP', 'CO_REVIEW', 'SAFETY', 'MATERIAL_REQUEST', 'INSPECTION_REMINDER');

-- CreateTable
CREATE TABLE "field_photos" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "daily_log_id" TEXT,
    "daily_labor_entry_id" TEXT,
    "field_issue_id" TEXT,
    "job_area_id" TEXT,
    "photo_date" DATE NOT NULL,
    "category" "FieldPhotoCategory" NOT NULL DEFAULT 'PROGRESS',
    "caption" TEXT,
    "area_text" TEXT,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "gps_lat" DECIMAL(10,7),
    "gps_lng" DECIMAL(10,7),
    "taken_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_issues" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "daily_log_id" TEXT,
    "type" "FieldIssueType" NOT NULL DEFAULT 'OFFICE_FOLLOW_UP',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "assigned_user_id" TEXT,
    "due_at" TIMESTAMP(3),
    "task_id" TEXT,
    "raised_by_user_id" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "field_photos_job_id_photo_date_idx" ON "field_photos"("job_id", "photo_date" DESC);

-- CreateIndex
CREATE INDEX "field_photos_job_id_category_idx" ON "field_photos"("job_id", "category");

-- CreateIndex
CREATE INDEX "field_photos_daily_log_id_idx" ON "field_photos"("daily_log_id");

-- CreateIndex
CREATE INDEX "field_photos_field_issue_id_idx" ON "field_photos"("field_issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "field_issues_task_id_key" ON "field_issues"("task_id");

-- CreateIndex
CREATE INDEX "field_issues_job_id_status_idx" ON "field_issues"("job_id", "status");

-- CreateIndex
CREATE INDEX "field_issues_assigned_user_id_status_idx" ON "field_issues"("assigned_user_id", "status");

-- AddForeignKey
ALTER TABLE "field_photos" ADD CONSTRAINT "field_photos_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_photos" ADD CONSTRAINT "field_photos_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "daily_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_photos" ADD CONSTRAINT "field_photos_daily_labor_entry_id_fkey" FOREIGN KEY ("daily_labor_entry_id") REFERENCES "daily_labor_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_photos" ADD CONSTRAINT "field_photos_field_issue_id_fkey" FOREIGN KEY ("field_issue_id") REFERENCES "field_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_photos" ADD CONSTRAINT "field_photos_job_area_id_fkey" FOREIGN KEY ("job_area_id") REFERENCES "job_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_photos" ADD CONSTRAINT "field_photos_taken_by_user_id_fkey" FOREIGN KEY ("taken_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_issues" ADD CONSTRAINT "field_issues_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_issues" ADD CONSTRAINT "field_issues_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "daily_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_issues" ADD CONSTRAINT "field_issues_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_issues" ADD CONSTRAINT "field_issues_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_issues" ADD CONSTRAINT "field_issues_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_issues" ADD CONSTRAINT "field_issues_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

