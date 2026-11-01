-- Zapis wyniku kalkulacji trasy przy ofercie.
--
-- Osobna tabela, nie kolumny na `offers` — stawki myta sie starzeja, wiec liczy
-- sie nie tylko kwota, ale i data policzenia oraz to, czy uzyte stawki wymagaja
-- weryfikacji. Historia pozwala odroznic wynik swiezy od policzonego pol roku
-- temu; kolumna nadpisywana w miejscu by tego nie oddala.
--
-- NIE zastepuje `offers.toll_cost_estimate`. Tamto pole zostaje reczna korekta
-- spedytora i ma pierwszenstwo nad wyliczeniem — obie wartosci stoja osobno.
--
-- Tabela jest pusta po migracji: nie liczymy trasy wstecz dla istniejacych ofert.
CREATE TABLE IF NOT EXISTS "route_calculations" (
    "id"                      TEXT NOT NULL,
    "offer_id"                TEXT NOT NULL,
    "company_id"              TEXT NOT NULL,
    "distance_km"             DOUBLE PRECISION NOT NULL,
    "toll_total_eur"          DECIMAL(10,2) NOT NULL,
    "toll_total_pln"          DECIMAL(10,2) NOT NULL,
    "toll_breakdown"          JSONB NOT NULL,
    "toll_unresolved"         JSONB NOT NULL,
    "toll_needs_verification" BOOLEAN NOT NULL DEFAULT false,
    "route_label"             TEXT,
    "calculated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_calculations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "route_calculations_offer_id_calculated_at_idx"
    ON "route_calculations"("offer_id", "calculated_at");

ALTER TABLE "route_calculations"
    ADD CONSTRAINT "route_calculations_offer_id_fkey"
    FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
