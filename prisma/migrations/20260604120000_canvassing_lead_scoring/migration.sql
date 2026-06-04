-- CreateTable
CREATE TABLE "canvassing_properties" (
    "id" TEXT NOT NULL,
    "reapi_id" TEXT NOT NULL,
    "property_address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "owner_name" TEXT,
    "mailing_address" TEXT,
    "owner_occupied" BOOLEAN,
    "year_built" INTEGER,
    "owned_since" INTEGER,
    "last_sale_date" DATE,
    "last_sale_price" INTEGER,
    "estimated_value" INTEGER,
    "estimated_mortgage_balance" INTEGER,
    "estimated_equity" INTEGER,
    "equity_percentage" INTEGER,
    "last_roof_permit_date" DATE,
    "estimated_roof_age" INTEGER,
    "roof_type" TEXT,
    "property_type" TEXT,
    "building_sqft" INTEGER,
    "stories" INTEGER,
    "lot_size_sqft" INTEGER,
    "knock_score" INTEGER NOT NULL DEFAULT 0,
    "knock_score_tier" TEXT,
    "recommended_opening" TEXT,
    "canvasser_summary_json" JSONB,
    "realapi_raw_json" JSONB,
    "last_realapi_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvassing_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvassing_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "scoring_config_json" JSONB NOT NULL,
    "min_priority_score" INTEGER NOT NULL DEFAULT 50,
    "show_absentee_owners" BOOLEAN NOT NULL DEFAULT true,
    "hide_low_score_properties" BOOLEAN NOT NULL DEFAULT false,
    "cache_ttl_days" INTEGER NOT NULL DEFAULT 30,
    "default_opening_script" TEXT NOT NULL,
    "compliance_disclaimer" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvassing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canvassing_properties_reapi_id_key" ON "canvassing_properties"("reapi_id");

-- CreateIndex
CREATE INDEX "canvassing_properties_knock_score_idx" ON "canvassing_properties"("knock_score");

-- CreateIndex
CREATE INDEX "canvassing_properties_state_city_idx" ON "canvassing_properties"("state", "city");
