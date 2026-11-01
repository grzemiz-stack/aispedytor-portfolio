-- Fleet planning: three values of the driver status may be unknown
-- (docs/decisions.md §11). NULL = "don't know"; the engine takes the
-- worst case and says so (DRIVER_STATE_ASSUMED):
--   weekly_rest_type          → REDUCED
--   last_home_rest_ended_at   → the rest at home is due at as_of
--   compensation_owed_minutes → 21 h for every reduced weekly rest of known date
-- compensation_owed_minutes loses DEFAULT 0: an omitted value was silently
-- "nothing owed", the favourable case. Existing rows keep their values.
-- Driving this week / last week and the end of the last weekly rest stay
-- NOT NULL — they have no usable worst case.

ALTER TABLE "driver_statuses"
    ALTER COLUMN "weekly_rest_type" DROP NOT NULL,
    ALTER COLUMN "last_home_rest_ended_at" DROP NOT NULL,
    ALTER COLUMN "compensation_owed_minutes" DROP NOT NULL,
    ALTER COLUMN "compensation_owed_minutes" DROP DEFAULT;

ALTER TABLE "driver_statuses" DROP CONSTRAINT "driver_statuses_minutes_check";
ALTER TABLE "driver_statuses" ADD CONSTRAINT "driver_statuses_minutes_check" CHECK (
    "driving_this_week_minutes" BETWEEN 0 AND 10080
    AND "driving_last_week_minutes" BETWEEN 0 AND 10080
    AND ("compensation_owed_minutes" IS NULL OR "compensation_owed_minutes" BETWEEN 0 AND 2520)
    AND ("driving_since_daily_rest_minutes" IS NULL OR "driving_since_daily_rest_minutes" BETWEEN 0 AND 1440)
    AND ("driving_since_break_minutes" IS NULL OR "driving_since_break_minutes" BETWEEN 0 AND 1440)
    AND ("work_since_break_minutes" IS NULL OR "work_since_break_minutes" BETWEEN 0 AND 1440)
);

-- Compensation owed needs its deadline; a deadline needs a known amount.
ALTER TABLE "driver_statuses" DROP CONSTRAINT "driver_statuses_compensation_check";
ALTER TABLE "driver_statuses" ADD CONSTRAINT "driver_statuses_compensation_check" CHECK (
    ("compensation_owed_minutes" IS NOT NULL OR "compensation_due_by" IS NULL)
    AND ("compensation_owed_minutes" IS NULL OR "compensation_owed_minutes" = 0 OR "compensation_due_by" IS NOT NULL)
);
