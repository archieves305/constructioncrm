-- CreateTable
CREATE TABLE "api_idempotency" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status_code" INTEGER,
    "response_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_idempotency_created_at_idx" ON "api_idempotency"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_idempotency_user_id_key_key" ON "api_idempotency"("user_id", "key");

