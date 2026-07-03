-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('W2', 'CONTRACTOR_1099', 'SUB_CREW', 'TEMP');

-- CreateEnum
CREATE TYPE "PersonnelStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PersonnelDocumentType" AS ENUM ('W9', 'GOVERNMENT_ID', 'CERTIFICATION', 'OTHER');

-- CreateTable
CREATE TABLE "personnel" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address1" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relation" TEXT,
    "trade" TEXT,
    "title" TEXT,
    "hourly_rate" DECIMAL(10,2),
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'W2',
    "status" "PersonnelStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE,
    "end_date" DATE,
    "entity_name" TEXT,
    "crew_id" TEXT,
    "user_id" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "ssn_ciphertext" TEXT,
    "ssn_last4" TEXT,
    "ssn_key_version" INTEGER,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personnel_documents" (
    "id" TEXT NOT NULL,
    "personnel_id" TEXT NOT NULL,
    "type" "PersonnelDocumentType" NOT NULL DEFAULT 'OTHER',
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "notes" TEXT,
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personnel_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personnel_user_id_key" ON "personnel"("user_id");

-- CreateIndex
CREATE INDEX "personnel_last_name_first_name_idx" ON "personnel"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "personnel_crew_id_idx" ON "personnel"("crew_id");

-- CreateIndex
CREATE INDEX "personnel_is_active_idx" ON "personnel"("is_active");

-- CreateIndex
CREATE INDEX "personnel_documents_personnel_id_idx" ON "personnel_documents"("personnel_id");

-- AddForeignKey
ALTER TABLE "personnel" ADD CONSTRAINT "personnel_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel" ADD CONSTRAINT "personnel_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel" ADD CONSTRAINT "personnel_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_documents" ADD CONSTRAINT "personnel_documents_personnel_id_fkey" FOREIGN KEY ("personnel_id") REFERENCES "personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_documents" ADD CONSTRAINT "personnel_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
