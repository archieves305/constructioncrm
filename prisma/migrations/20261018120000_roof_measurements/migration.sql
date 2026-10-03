-- CreateEnum
CREATE TYPE "RoofMeasurementSource" AS ENUM ('ROOFR', 'MANUAL', 'FIELD');

-- AlterEnum
ALTER TYPE "FileCategory" ADD VALUE 'MEASUREMENT_REPORT';

-- CreateTable
CREATE TABLE "roof_measurements" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "job_id" TEXT,
    "file_id" TEXT,
    "roofr_order_id" TEXT,
    "source" "RoofMeasurementSource" NOT NULL DEFAULT 'ROOFR',
    "label" TEXT,
    "report_date" TIMESTAMP(3),
    "parsed_address" TEXT,
    "existing_roof_type" TEXT,
    "total_squares" DOUBLE PRECISION,
    "roof_area_sq_ft" DOUBLE PRECISION,
    "pitched_area_sq_ft" DOUBLE PRECISION,
    "flat_area_sq_ft" DOUBLE PRECISION,
    "pitch_bands" JSONB,
    "facets" INTEGER,
    "predominant_pitch" TEXT,
    "eaves_lf" DOUBLE PRECISION,
    "rakes_lf" DOUBLE PRECISION,
    "valleys_lf" DOUBLE PRECISION,
    "hips_lf" DOUBLE PRECISION,
    "ridges_lf" DOUBLE PRECISION,
    "ridges_hips_lf" DOUBLE PRECISION,
    "drip_edge_lf" DOUBLE PRECISION,
    "step_flashing_lf" DOUBLE PRECISION,
    "flashing_lf" DOUBLE PRECISION,
    "flashing_area_sq_ft" DOUBLE PRECISION,
    "penetrations" INTEGER,
    "skylights" INTEGER,
    "chimneys" INTEGER,
    "stories" INTEGER,
    "report_waste_pct" DOUBLE PRECISION,
    "report_waste_options" JSONB,
    "parse_confidence" DOUBLE PRECISION,
    "field_confidence" JSONB,
    "overrides" JSONB,
    "raw_extract" JSONB,
    "warnings" JSONB,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_user_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roof_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roof_measurements_file_id_key" ON "roof_measurements"("file_id");

-- CreateIndex
CREATE INDEX "roof_measurements_lead_id_idx" ON "roof_measurements"("lead_id");

-- CreateIndex
CREATE INDEX "roof_measurements_job_id_idx" ON "roof_measurements"("job_id");

-- AddForeignKey
ALTER TABLE "roof_measurements" ADD CONSTRAINT "roof_measurements_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roof_measurements" ADD CONSTRAINT "roof_measurements_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roof_measurements" ADD CONSTRAINT "roof_measurements_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roof_measurements" ADD CONSTRAINT "roof_measurements_roofr_order_id_fkey" FOREIGN KEY ("roofr_order_id") REFERENCES "roofr_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roof_measurements" ADD CONSTRAINT "roof_measurements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roof_measurements" ADD CONSTRAINT "roof_measurements_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

