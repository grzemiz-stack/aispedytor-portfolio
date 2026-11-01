-- Fleet planning, stage 1: drivers and their manual status
-- (docs/fleet-planning/SPEC.md §6). Additive only.
--
-- One driver per vehicle (single crew): UNIQUE on vehicle_id. Whether the
-- vehicle is a power unit (not a trailer) is checked by the API — it needs
-- the vehicle's category, which a CHECK cannot read from another table.
--
-- driver_statuses is append-only: the newest row is the current status.
-- The CHECKs hold physical bounds, not legal ones: a status may describe a
-- driver who already broke a rule — the planner reports it, nothing blocks it.

CREATE TYPE "WeeklyRestType" AS ENUM ('REGULAR', 'REDUCED');
CREATE TYPE "DriverUnavailableReason" AS ENUM ('LEAVE', 'SICKNESS', 'DRIVER_REQUEST', 'OTHER');

CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "home_city" TEXT,
    "home_country" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "vehicle_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "driver_statuses" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "entered_by_id" TEXT,
    "as_of" TIMESTAMP(3) NOT NULL,
    "weekly_rest_ended_at" TIMESTAMP(3) NOT NULL,
    "weekly_rest_type" "WeeklyRestType" NOT NULL,
    "weekly_rest_abroad" BOOLEAN NOT NULL DEFAULT false,
    "weekly_rest_at_home" BOOLEAN NOT NULL DEFAULT false,
    "recent_weekly_rests" JSONB,
    "driving_this_week_minutes" INTEGER NOT NULL,
    "driving_last_week_minutes" INTEGER NOT NULL,
    "extended_driving_days_used" INTEGER,
    "reduced_daily_rests_used" INTEGER,
    "compensation_owed_minutes" INTEGER NOT NULL DEFAULT 0,
    "compensation_due_by" TIMESTAMP(3),
    "last_home_rest_ended_at" TIMESTAMP(3) NOT NULL,
    "driver_chose_to_stay_away" BOOLEAN NOT NULL DEFAULT false,
    "daily_rest_ended_at" TIMESTAMP(3),
    "driving_since_daily_rest_minutes" INTEGER,
    "driving_since_break_minutes" INTEGER,
    "work_since_break_minutes" INTEGER,
    "unavailable_until" TIMESTAMP(3),
    "unavailable_reason" "DriverUnavailableReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_statuses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "drivers_company_id_idx" ON "drivers"("company_id");
CREATE UNIQUE INDEX "drivers_vehicle_id_key" ON "drivers"("vehicle_id");
CREATE INDEX "driver_statuses_driver_id_created_at_idx" ON "driver_statuses"("driver_id", "created_at");

ALTER TABLE "drivers" ADD CONSTRAINT "drivers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "driver_statuses" ADD CONSTRAINT "driver_statuses_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_statuses" ADD CONSTRAINT "driver_statuses_entered_by_id_fkey" FOREIGN KEY ("entered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Physical bounds (a fixed week has 10080 minutes; a weekly rest can be
-- reduced by at most 21 h, and at most two reductions can be owed at once).
ALTER TABLE "driver_statuses" ADD CONSTRAINT "driver_statuses_minutes_check" CHECK (
    "driving_this_week_minutes" BETWEEN 0 AND 10080
    AND "driving_last_week_minutes" BETWEEN 0 AND 10080
    AND "compensation_owed_minutes" BETWEEN 0 AND 2520
    AND ("driving_since_daily_rest_minutes" IS NULL OR "driving_since_daily_rest_minutes" BETWEEN 0 AND 1440)
    AND ("driving_since_break_minutes" IS NULL OR "driving_since_break_minutes" BETWEEN 0 AND 1440)
    AND ("work_since_break_minutes" IS NULL OR "work_since_break_minutes" BETWEEN 0 AND 1440)
);
ALTER TABLE "driver_statuses" ADD CONSTRAINT "driver_statuses_counters_check" CHECK (
    ("extended_driving_days_used" IS NULL OR "extended_driving_days_used" BETWEEN 0 AND 7)
    AND ("reduced_daily_rests_used" IS NULL OR "reduced_daily_rests_used" BETWEEN 0 AND 7)
);
-- Compensation owed needs its deadline; unavailability needs both the end and the reason.
ALTER TABLE "driver_statuses" ADD CONSTRAINT "driver_statuses_compensation_check" CHECK (
    "compensation_owed_minutes" = 0 OR "compensation_due_by" IS NOT NULL
);
ALTER TABLE "driver_statuses" ADD CONSTRAINT "driver_statuses_unavailable_check" CHECK (
    ("unavailable_until" IS NULL) = ("unavailable_reason" IS NULL)
);
