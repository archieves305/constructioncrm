-- CreateEnum
CREATE TYPE "DailyLogStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED');

-- AlterTable
ALTER TABLE "budget_allocations" ADD COLUMN     "daily_labor_entry_id" TEXT;

-- CreateTable
CREATE TABLE "job_field_assignments" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_field_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_logs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "log_date" DATE NOT NULL,
    "status" "DailyLogStatus" NOT NULL DEFAULT 'DRAFT',
    "manager_user_id" TEXT,
    "weather_summary" TEXT,
    "weather_temp_high_f" INTEGER,
    "weather_temp_low_f" INTEGER,
    "weather_precip_in" DECIMAL(5,2),
    "weather_wind_mph" INTEGER,
    "weather_source" TEXT,
    "weather_fetched_at" TIMESTAMP(3),
    "work_performed" TEXT,
    "areas_worked" TEXT,
    "materials_delivered" TEXT,
    "equipment_used" TEXT,
    "subcontractors_onsite" TEXT,
    "inspections_notes" TEXT,
    "delays" TEXT,
    "safety_issues" TEXT,
    "change_order_items" TEXT,
    "owner_instructions" TEXT,
    "office_follow_ups" TEXT,
    "tomorrow_plan" TEXT,
    "notes" TEXT,
    "submitted_at" TIMESTAMP(3),
    "submitted_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by_user_id" TEXT,
    "return_note" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_labor_entries" (
    "id" TEXT NOT NULL,
    "daily_log_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "personnel_id" TEXT NOT NULL,
    "trade" TEXT,
    "job_area_id" TEXT,
    "work_area" TEXT,
    "start_minutes" INTEGER,
    "end_minutes" INTEGER,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "total_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "regular_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "ot_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "regular_rate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ot_rate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cost_code_id" TEXT,
    "phase" TEXT,
    "budget_line_id" TEXT,
    "is_absent" BOOLEAN NOT NULL DEFAULT false,
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "left_early" BOOLEAN NOT NULL DEFAULT false,
    "absence_reason" TEXT,
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_labor_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_field_assignments_user_id_idx" ON "job_field_assignments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_field_assignments_job_id_user_id_key" ON "job_field_assignments"("job_id", "user_id");

-- CreateIndex
CREATE INDEX "daily_logs_job_id_log_date_idx" ON "daily_logs"("job_id", "log_date" DESC);

-- CreateIndex
CREATE INDEX "daily_logs_status_idx" ON "daily_logs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_logs_job_id_log_date_key" ON "daily_logs"("job_id", "log_date");

-- CreateIndex
CREATE INDEX "daily_labor_entries_job_id_work_date_idx" ON "daily_labor_entries"("job_id", "work_date");

-- CreateIndex
CREATE INDEX "daily_labor_entries_personnel_id_work_date_idx" ON "daily_labor_entries"("personnel_id", "work_date");

-- CreateIndex
CREATE INDEX "daily_labor_entries_daily_log_id_idx" ON "daily_labor_entries"("daily_log_id");

-- CreateIndex
CREATE INDEX "daily_labor_entries_cost_code_id_idx" ON "daily_labor_entries"("cost_code_id");

-- CreateIndex
CREATE INDEX "daily_labor_entries_budget_line_id_idx" ON "daily_labor_entries"("budget_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_allocations_daily_labor_entry_id_key" ON "budget_allocations"("daily_labor_entry_id");

-- AddForeignKey
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_daily_labor_entry_id_fkey" FOREIGN KEY ("daily_labor_entry_id") REFERENCES "daily_labor_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_field_assignments" ADD CONSTRAINT "job_field_assignments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_field_assignments" ADD CONSTRAINT "job_field_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_field_assignments" ADD CONSTRAINT "job_field_assignments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_labor_entries" ADD CONSTRAINT "daily_labor_entries_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_labor_entries" ADD CONSTRAINT "daily_labor_entries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_labor_entries" ADD CONSTRAINT "daily_labor_entries_personnel_id_fkey" FOREIGN KEY ("personnel_id") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_labor_entries" ADD CONSTRAINT "daily_labor_entries_job_area_id_fkey" FOREIGN KEY ("job_area_id") REFERENCES "job_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_labor_entries" ADD CONSTRAINT "daily_labor_entries_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_labor_entries" ADD CONSTRAINT "daily_labor_entries_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_labor_entries" ADD CONSTRAINT "daily_labor_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
