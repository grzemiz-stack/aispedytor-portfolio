-- Dodaje DMC zestawu i mase wlasna do kartoteki pojazdu.
--
-- Sciezka LTL miala dotad tylko `max_weight_kg` (ladownosc), czyli odpowiedz na
-- pytanie "ile wolno polozyc". Brakowalo odpowiedzi na "ile caly zestaw wolno
-- wazyc" — a to ta druga wielkosc odpowiada mandatowi za przeciazenie.
-- Wczesniej obchodzono to stala `maxWeightKg + 14500`, usunieta razem
-- z modelem nacisku osi (docs/usuniecie-osi.md).
--
-- Kolumny sa NULLable i celowo NIE sa wypelniane: to dane, ktore musi podac
-- uzytkownik. Do czasu uzupelnienia sciezka LTL odmawia wyliczenia z jawnym
-- bledem IncompleteVehicleRecord, zamiast podstawiac liczbe.
--
-- ADD COLUMN IF NOT EXISTS — idempotentne, bezpieczne przy ponownym uruchomieniu.
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "gross_vehicle_weight_kg" INTEGER;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "curb_weight_kg" INTEGER;
