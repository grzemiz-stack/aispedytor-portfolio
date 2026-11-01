-- Toll amounts come only from a registered TollProvider (src/tolls).
-- Rows saved before were computed from internal rate tables that no longer
-- exist; they are removed rather than kept without a source.
DELETE FROM "route_calculations";

-- Name of the provider that produced the toll in this row.
ALTER TABLE "route_calculations" ADD COLUMN "toll_source" TEXT NOT NULL;
