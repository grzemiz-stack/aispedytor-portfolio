-- Usuwa kolumny, ktore istnialy wylacznie na potrzeby rozszerzenia Chrome
-- parsujacego gieldy transportowe. Rozszerzenie i moduly je obslugujace zostaly
-- usuniete; zaden kod ich juz nie zapisuje ani nie odczytuje.
--
-- Stan danych w chwili usuwania (aispedytor_prod, 130 ofert, 13 kontrahentow):
--   offers.raw_data      — NULL w 130/130
--   offers.source_url    — NULL w 130/130
--   offers.scraped_at    — NULL w 130/130, nigdy nie bylo zapisywane przez zaden kod
--   contractors.source_platform — NULL w 13/13, nigdy nie bylo zapisywane
-- Operacja nie kasuje zadnej istniejacej wartosci.
--
-- CELOWO NIE USUWANE: wartosci TRANS_EU, TIMOCOM i TELEROUTE z typu OfferSource.
-- Uzywa ich 83 ze 130 wierszy (46 + 35 + 2). Usuniecie wymagaloby przepisania
-- typu i tych wierszy, czyli decyzji, co zrobic z danymi — patrz
-- docs/usuniecie-wtyczki.md sekcja „Wartosci enuma OfferSource".

ALTER TABLE "offers" DROP COLUMN "raw_data";
ALTER TABLE "offers" DROP COLUMN "source_url";
ALTER TABLE "offers" DROP COLUMN "scraped_at";
ALTER TABLE "contractors" DROP COLUMN "source_platform";
