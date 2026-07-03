-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7);

-- CreateTable
CREATE TABLE "cost_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phase" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_areas" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "floor" TEXT,
    "unit" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_settings" (
    "id" TEXT NOT NULL,
    "ot_weekly_threshold" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "ot_daily_threshold" DECIMAL(5,2),
    "ot_multiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.5,
    "week_starts_on" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_codes_code_key" ON "cost_codes"("code");

-- CreateIndex
CREATE INDEX "job_areas_job_id_idx" ON "job_areas"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_areas_job_id_name_key" ON "job_areas"("job_id", "name");

-- AddForeignKey
ALTER TABLE "job_areas" ADD CONSTRAINT "job_areas_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
