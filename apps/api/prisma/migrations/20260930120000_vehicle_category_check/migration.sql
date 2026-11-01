-- Zamknięta lista kategorii pojazdu. Kolumna zostaje TEXT (zmiana na enum
-- nie byłaby addytywna); baza przestaje przyjmować literówki.
--
-- Lista MUSI być równa VEHICLE_CATEGORIES w apps/api/src/common/
-- vehicle-category.ts — pilnuje tego test vehicle-category-check.spec.ts.
-- Nowa kategoria: RIGID (solówka).
ALTER TABLE "vehicles"
    ADD CONSTRAINT "vehicles_vehicle_category_check"
    CHECK ("vehicle_category" IN ('TRUCK', 'RIGID', 'SEMI_TRAILER', 'TRAILER', 'VAN'));
