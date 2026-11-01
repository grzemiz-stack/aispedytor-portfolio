-- Kody kategorii TRAILER i SEMI_TRAILER były nazwane odwrotnie niż po
-- angielsku: TRAILER znaczył naczepę, SEMI_TRAILER przyczepę. Od teraz
-- kod = znaczenie angielskie: SEMI_TRAILER = naczepa, TRAILER = przyczepa
-- (DECYZJE.md §2.13).
--
-- Jeden UPDATE z CASE: obie wartości zamieniają się w jednej instrukcji,
-- więc w bazie nigdy nie ma stanu pośredniego ani wartości tymczasowej.
UPDATE "vehicles"
SET "vehicle_category" = CASE "vehicle_category"
    WHEN 'TRAILER' THEN 'SEMI_TRAILER'
    WHEN 'SEMI_TRAILER' THEN 'TRAILER'
END
WHERE "vehicle_category" IN ('TRAILER', 'SEMI_TRAILER');
