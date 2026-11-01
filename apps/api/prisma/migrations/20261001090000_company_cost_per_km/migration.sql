-- Koszt kilometra firmy i jej waluta — podstawa zysku w rankingu LTL
-- (DECYZJE.md §2.2). Zmiana addytywna.
--
-- cost_per_km NULL = firma nie podała kosztu; ranking liczy wtedy przychód,
-- nie zysk. Zero odrzucone: „jedziemy za darmo" to nie koszt, tylko brak danych.
--
-- cost_currency to waluta, w której firma liczy — także waluta rankingu,
-- gdy kosztu nie ma — więc NOT NULL z domyślnym PLN. Lista MUSI być równa
-- COMPANY_CURRENCIES w apps/api/src/common/company-currency.ts — pilnuje
-- tego test company-currency-check.spec.ts.
ALTER TABLE "companies"
    ADD COLUMN "cost_per_km" DECIMAL(10,2),
    ADD COLUMN "cost_currency" TEXT NOT NULL DEFAULT 'PLN';

ALTER TABLE "companies"
    ADD CONSTRAINT "companies_cost_per_km_check"
    CHECK ("cost_per_km" > 0);

ALTER TABLE "companies"
    ADD CONSTRAINT "companies_cost_currency_check"
    CHECK ("cost_currency" IN ('PLN', 'EUR', 'GBP'));

-- Istniejące firmy: waluta z kraju, ta sama reguła co currencyForCountry()
-- przy rejestracji (GB → GBP, strefa euro → EUR, reszta → PLN). Listę strefy
-- euro porównuje z EUROZONE_COUNTRIES test company-currency-check.spec.ts.
UPDATE "companies"
SET "cost_currency" = CASE
    WHEN UPPER(TRIM("country")) = 'GB' THEN 'GBP'
    WHEN UPPER(TRIM("country")) IN ('AT', 'BE', 'BG', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR',
                                    'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK') THEN 'EUR'
    ELSE 'PLN'
END;
