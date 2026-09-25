-- CreateTable
CREATE TABLE "allocator_posting_acks" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payee" TEXT,
    "posted_on" TIMESTAMP(3) NOT NULL,
    "crm_job_id" TEXT,
    "note" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocator_posting_acks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allocator_posting_acks_external_id_key" ON "allocator_posting_acks"("external_id");

-- AddForeignKey
ALTER TABLE "allocator_posting_acks" ADD CONSTRAINT "allocator_posting_acks_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

