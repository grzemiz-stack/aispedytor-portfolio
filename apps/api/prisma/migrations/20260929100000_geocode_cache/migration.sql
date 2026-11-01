-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "coords_checked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "geocode_cache" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "found" BOOLEAN NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "geocode_cache_query_key" ON "geocode_cache"("query");


-- Spójność wpisu, której Prisma nie wyraża: „znaleziono" wymaga obu
-- współrzędnych, „nie znaleziono" nie dopuszcza żadnej. Zakresy
-- geograficzne łapią zamienione lat/lng.
ALTER TABLE "geocode_cache"
    ADD CONSTRAINT "geocode_cache_found_coords_check"
    CHECK (
        (found AND lat IS NOT NULL AND lng IS NOT NULL)
        OR (NOT found AND lat IS NULL AND lng IS NULL)
    ),
    ADD CONSTRAINT "geocode_cache_lat_range_check" CHECK (lat BETWEEN -90 AND 90),
    ADD CONSTRAINT "geocode_cache_lng_range_check" CHECK (lng BETWEEN -180 AND 180);
