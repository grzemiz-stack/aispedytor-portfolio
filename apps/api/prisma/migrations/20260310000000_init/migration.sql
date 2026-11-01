-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'BASIC', 'PRO');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DISPATCHER');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('TRUCK', 'VAN', 'MEGA', 'STANDARD', 'REFRIGERATED');

-- CreateEnum
CREATE TYPE "TrailerType" AS ENUM ('CURTAIN', 'BOX', 'REEFER', 'FLATBED', 'TANKER');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'IN_TRANSIT', 'LOADING', 'RETURNING');

-- CreateEnum
CREATE TYPE "OfferSource" AS ENUM ('TRANS_EU', 'TIMOCOM', 'TELEROUTE', 'EMAIL', 'MANUAL');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('NEW', 'ASSIGNED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_OFFER', 'URGENT', 'RELOAD', 'RETURN', 'RISK_ALERT');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "subscription_plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "max_dispatchers" INTEGER NOT NULL DEFAULT 10,
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email_encrypted" TEXT NOT NULL,
    "email_hash" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name_encrypted" TEXT NOT NULL,
    "last_name_encrypted" TEXT NOT NULL,
    "phone_encrypted" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'DISPATCHER',
    "preferences" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "dispatcher_id" TEXT,
    "plate_number" TEXT NOT NULL,
    "vehicle_type" "VehicleType" NOT NULL,
    "trailer_type" "TrailerType",
    "max_weight_kg" INTEGER,
    "max_volume_m3" DOUBLE PRECISION,
    "length_m" DOUBLE PRECISION,
    "height_m" DOUBLE PRECISION,
    "width_m" DOUBLE PRECISION,
    "adr_classes" TEXT[],
    "current_lat" DOUBLE PRECISION,
    "current_lng" DOUBLE PRECISION,
    "current_city" TEXT,
    "current_country" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "available_from" TIMESTAMP(3),
    "free_meters" DOUBLE PRECISION,
    "free_weight_kg" INTEGER,
    "current_direction" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "external_id" TEXT,
    "source" "OfferSource" NOT NULL DEFAULT 'MANUAL',
    "status" "OfferStatus" NOT NULL DEFAULT 'NEW',
    "assigned_to_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "pickup_city" TEXT NOT NULL,
    "pickup_country" TEXT NOT NULL,
    "pickup_postal" TEXT,
    "pickup_lat" DOUBLE PRECISION,
    "pickup_lng" DOUBLE PRECISION,
    "delivery_city" TEXT NOT NULL,
    "delivery_country" TEXT NOT NULL,
    "delivery_postal" TEXT,
    "delivery_lat" DOUBLE PRECISION,
    "delivery_lng" DOUBLE PRECISION,
    "pickup_date" TIMESTAMP(3) NOT NULL,
    "delivery_date" TIMESTAMP(3),
    "cargo_type" TEXT,
    "weight_kg" DOUBLE PRECISION,
    "volume_m3" DOUBLE PRECISION,
    "length_m" DOUBLE PRECISION,
    "is_adr" BOOLEAN NOT NULL DEFAULT false,
    "adr_class" TEXT,
    "is_frigo" BOOLEAN NOT NULL DEFAULT false,
    "temperature_min" DOUBLE PRECISION,
    "temperature_max" DOUBLE PRECISION,
    "price" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "price_per_km" DECIMAL(10,2),
    "client_name" TEXT,
    "contractor_id" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "raw_data" JSONB,
    "scraped_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractors" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "country" TEXT,
    "avg_payment_days" INTEGER,
    "payment_rating" INTEGER,
    "reliability_score" INTEGER,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "is_blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "source_platform" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_analyses" (
    "id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "profitability_score" INTEGER,
    "risk_score" INTEGER,
    "time_urgency_score" INTEGER,
    "fleet_match_score" INTEGER,
    "overall_score" INTEGER,
    "estimated_distance_km" INTEGER,
    "estimated_duration_h" DOUBLE PRECISION,
    "estimated_fuel_cost" DECIMAL(10,2),
    "estimated_toll_cost" DECIMAL(10,2),
    "estimated_total_cost" DECIMAL(10,2),
    "estimated_margin" DECIMAL(10,2),
    "estimated_margin_pct" DECIMAL(5,2),
    "empty_km" INTEGER,
    "empty_km_cost" DECIMAL(10,2),
    "matched_vehicle_id" TEXT,
    "is_reload_candidate" BOOLEAN NOT NULL DEFAULT false,
    "is_return_candidate" BOOLEAN NOT NULL DEFAULT false,
    "ai_comment" TEXT,
    "ai_model_version" TEXT,
    "raw_analysis" JSONB,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatcher_demands" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "dispatcher_id" TEXT NOT NULL,
    "available_trucks" INTEGER,
    "vehicle_types" TEXT[],
    "regions" TEXT[],
    "max_pickup_radius_km" INTEGER,
    "preferred_countries" TEXT[],
    "preferred_directions" TEXT[],
    "min_price_per_km" DECIMAL(10,2),
    "min_margin_pct" DECIMAL(5,2),
    "search_reloads" BOOLEAN NOT NULL DEFAULT false,
    "search_returns" BOOLEAN NOT NULL DEFAULT false,
    "max_extra_stops" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatcher_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "offer_id" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_hash_key" ON "users"("email_hash");

-- CreateIndex
CREATE INDEX "users_company_id_idx" ON "users"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "vehicles_company_id_status_idx" ON "vehicles"("company_id", "status");

-- CreateIndex
CREATE INDEX "vehicles_company_id_dispatcher_id_idx" ON "vehicles"("company_id", "dispatcher_id");

-- CreateIndex
CREATE INDEX "offers_company_id_status_assigned_to_id_idx" ON "offers"("company_id", "status", "assigned_to_id");

-- CreateIndex
CREATE INDEX "offers_company_id_pickup_country_delivery_country_idx" ON "offers"("company_id", "pickup_country", "delivery_country");

-- CreateIndex
CREATE INDEX "offers_expires_at_idx" ON "offers"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "offers_company_id_source_external_id_key" ON "offers"("company_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "contractors_company_id_name_idx" ON "contractors"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "offer_analyses_offer_id_key" ON "offer_analyses"("offer_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_dispatcher_id_fkey" FOREIGN KEY ("dispatcher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_analyses" ADD CONSTRAINT "offer_analyses_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_analyses" ADD CONSTRAINT "offer_analyses_matched_vehicle_id_fkey" FOREIGN KEY ("matched_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatcher_demands" ADD CONSTRAINT "dispatcher_demands_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatcher_demands" ADD CONSTRAINT "dispatcher_demands_dispatcher_id_fkey" FOREIGN KEY ("dispatcher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
