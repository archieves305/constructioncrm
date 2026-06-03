-- CreateTable
CREATE TABLE "zylow_property_cache" (
    "reapi_id" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "county" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "owner_name" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" DECIMAL(4,1),
    "sqft" INTEGER,
    "year_built" INTEGER,
    "property_type" TEXT,
    "roof_type" TEXT,
    "last_sale_date" DATE,
    "last_sale_amount" INTEGER,
    "outstanding_mortgages" INTEGER,
    "estimated_value" INTEGER,
    "cached_at_zylow" TIMESTAMP(3),
    "fetched_at_local" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zylow_property_cache_pkey" PRIMARY KEY ("reapi_id")
);

-- CreateIndex
CREATE INDEX "zylow_property_cache_state_city_idx" ON "zylow_property_cache"("state", "city");

-- CreateIndex
CREATE INDEX "zylow_property_cache_latitude_longitude_idx" ON "zylow_property_cache"("latitude", "longitude");
