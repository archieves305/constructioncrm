-- CreateTable
CREATE TABLE "mobile_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "app_version" TEXT,
    "device_name" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_device_tokens" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mobile_devices_user_id_idx" ON "mobile_devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_devices_user_id_installation_id_key" ON "mobile_devices"("user_id", "installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_device_tokens_token_hash_key" ON "mobile_device_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "mobile_device_tokens_device_id_idx" ON "mobile_device_tokens"("device_id");

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_device_tokens" ADD CONSTRAINT "mobile_device_tokens_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "mobile_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

