-- Usuwa kolumne offers.search_radius.
--
-- Byla zapisywana wylacznie przy tworzeniu oferty (CreateOfferDto.searchRadius)
-- i nie odczytywana przez nikogo — ani w API, ani w apps/web, ani w seedzie,
-- ani w testach. Trasa GET /api/offers/search miala parametr `radius`, ktory
-- nigdy nie docieral do zapytania; zostal usuniety w poprzednim commicie.
--
-- Stan danych w chwili usuwania (aispedytor_prod): NULL w 130/130 wierszy.
-- Operacja nie kasuje zadnej istniejacej wartosci.

ALTER TABLE "offers" DROP COLUMN "search_radius";
