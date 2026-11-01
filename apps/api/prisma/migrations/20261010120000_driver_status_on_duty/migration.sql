-- Fleet planning: whether the driver is on duty at `as_of` is explicit
-- (docs/decisions.md §11). Before, "no end of a daily rest" meant "resting" —
-- a status that simply left the duty block out counted as fully rested.
--   on_duty TRUE  — on duty; the end of the daily rest is required
--   on_duty FALSE — resting
--   on_duty NULL  — unknown; the engine takes the worst case (on duty with
--                   the day's driving, the break and work used up) and says so
-- Existing rows keep their meaning: with a daily rest end → TRUE, without → FALSE.

ALTER TABLE "driver_statuses" ADD COLUMN "on_duty" BOOLEAN;
UPDATE "driver_statuses" SET "on_duty" = ("daily_rest_ended_at" IS NOT NULL);

-- The end of the daily rest only with on_duty TRUE, and always with it.
ALTER TABLE "driver_statuses" ADD CONSTRAINT "driver_statuses_on_duty_check" CHECK (
    ("daily_rest_ended_at" IS NULL OR "on_duty" IS TRUE)
    AND ("on_duty" IS NOT TRUE OR "daily_rest_ended_at" IS NOT NULL)
);
