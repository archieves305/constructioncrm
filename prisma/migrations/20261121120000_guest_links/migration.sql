-- Release 2 guest links (additive): crew links with hashed codes, submissions held for review, crew assignment confirmations.
ALTER TABLE "crew_assignments" ADD COLUMN "confirmation" TEXT,
ADD COLUMN     "confirmation_at" TIMESTAMP(3);



-- CreateTable
CREATE TABLE "guest_links" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "labor_contract_id" TEXT,
    "crew_assignment_id" TEXT,
    "crew_id" TEXT,
    "recipient_name" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "first_opened_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_submissions" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "review_note" TEXT,
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_links_token_hash_key" ON "guest_links"("token_hash");

-- CreateIndex
CREATE INDEX "guest_links_job_id_idx" ON "guest_links"("job_id");

-- CreateIndex
CREATE INDEX "guest_links_labor_contract_id_idx" ON "guest_links"("labor_contract_id");

-- CreateIndex
CREATE INDEX "guest_submissions_status_created_at_idx" ON "guest_submissions"("status", "created_at");

-- CreateIndex
CREATE INDEX "guest_submissions_job_id_idx" ON "guest_submissions"("job_id");

-- AddForeignKey
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_labor_contract_id_fkey" FOREIGN KEY ("labor_contract_id") REFERENCES "labor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_crew_assignment_id_fkey" FOREIGN KEY ("crew_assignment_id") REFERENCES "crew_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_submissions" ADD CONSTRAINT "guest_submissions_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "guest_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_submissions" ADD CONSTRAINT "guest_submissions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_submissions" ADD CONSTRAINT "guest_submissions_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

