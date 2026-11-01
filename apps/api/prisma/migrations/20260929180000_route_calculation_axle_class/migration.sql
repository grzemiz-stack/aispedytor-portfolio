-- AlterTable
ALTER TABLE "route_calculations" ADD COLUMN     "axle_class" TEXT,
ADD COLUMN     "axle_class_defaulted" BOOLEAN NOT NULL DEFAULT false;


-- Wartości klasy — kubełki taryfowe planera, nic poza nimi.
-- Klasa domyślna wymaga klasy: flaga bez klasy nie ma znaczenia.
ALTER TABLE "route_calculations"
    ADD CONSTRAINT "route_calculations_axle_class_check"
    CHECK (axle_class IN ('2', '3', '4', '5+')),
    ADD CONSTRAINT "route_calculations_axle_class_defaulted_check"
    CHECK (NOT axle_class_defaulted OR axle_class IS NOT NULL);
