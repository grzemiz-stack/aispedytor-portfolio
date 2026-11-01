-- Contractor order count is computed on read.
-- `contractors.total_orders` was never written by the application (only the
-- seed set made-up numbers), yet negotiation showed it as the number of orders.
-- Now negotiation counts the contractor's offers in the revenue statuses
-- (ACCEPTED, IN_TRANSIT, COMPLETED) when it reads the profile.
-- Removes data: the column values are dropped (they were not real orders).

ALTER TABLE "contractors" DROP COLUMN "total_orders";
