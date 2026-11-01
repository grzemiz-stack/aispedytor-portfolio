/**
 * Polish risk keywords (transport and forwarding) for free-text scanning.
 * The keywords and messages are Polish on purpose: they match Polish offer text.
 * Each keyword triggers a risk item when found in offer notes, specialRequirements, or penaltyClauses
 * (case-insensitive substring match, checked in the order of this list).
 */

export type RiskKeywordLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RiskKeyword {
  keyword: string;
  category: string;
  level: RiskKeywordLevel;
  message: string;
}

export const RISK_KEYWORDS: RiskKeyword[] = [
  // ── PENALTY_RISK ──────────────────────────────────────────────────────
  { keyword: 'kara umowna', category: 'PENALTY_RISK', level: 'HIGH', message: 'Wykryto klauzulę kar umownych — sprawdź warunki i wysokość kar.' },
  { keyword: 'kary umowne', category: 'PENALTY_RISK', level: 'HIGH', message: 'Wykryto klauzulę kar umownych — sprawdź warunki i wysokość kar.' },
  { keyword: 'nota obciążeniowa', category: 'PENALTY_RISK', level: 'HIGH', message: 'Oferta wspomina noty obciążeniowe — ryzyko dodatkowych kosztów.' },
  { keyword: 'odszkodowanie', category: 'PENALTY_RISK', level: 'HIGH', message: 'Wymieniono odszkodowanie — sprawdź zakres odpowiedzialności.' },
  { keyword: 'reklamacja', category: 'PENALTY_RISK', level: 'MEDIUM', message: 'Wykryto procedurę reklamacyjną — zapoznaj się z warunkami.' },
  { keyword: 'potrącenie z frachtu', category: 'PENALTY_RISK', level: 'HIGH', message: 'Możliwe potrącenie z frachtu — wysokie ryzyko finansowe.' },

  // ── DELAY_PENALTY ─────────────────────────────────────────────────────
  { keyword: 'za każdą godzinę', category: 'DELAY_PENALTY', level: 'HIGH', message: 'Kara naliczana za każdą godzinę — ryzyko wysokich kosztów przy opóźnieniu.' },
  { keyword: 'za każdy dzień', category: 'DELAY_PENALTY', level: 'HIGH', message: 'Kara naliczana za każdy dzień — ryzyko kumulacji kosztów.' },
  { keyword: 'opóźnienie', category: 'DELAY_PENALTY', level: 'MEDIUM', message: 'Oferta reguluje kwestię opóźnień — sprawdź konsekwencje.' },
  { keyword: 'spóźnienie', category: 'DELAY_PENALTY', level: 'MEDIUM', message: 'Oferta reguluje kwestię spóźnień — sprawdź konsekwencje.' },
  { keyword: 'przestój', category: 'DELAY_PENALTY', level: 'MEDIUM', message: 'Wymieniono przestój — sprawdź koszty i czas oczekiwania.' },

  // ── TIME_WINDOW ───────────────────────────────────────────────────────
  { keyword: 'okno czasowe', category: 'TIME_WINDOW', level: 'MEDIUM', message: 'Ściśle określone okno czasowe — ryzyko kary za niedotrzymanie.' },
  { keyword: 'awizacja', category: 'TIME_WINDOW', level: 'LOW', message: 'Wymagana awizacja — pamiętaj o wcześniejszym zgłoszeniu.' },
  { keyword: 'slot', category: 'TIME_WINDOW', level: 'MEDIUM', message: 'Wymagany slot załadunkowy/rozładunkowy — ograniczone okno czasowe.' },
  { keyword: 'rampa', category: 'TIME_WINDOW', level: 'LOW', message: 'Wspomniano rampę — sprawdź godziny dostępności.' },
  { keyword: 'fix termin', category: 'TIME_WINDOW', level: 'HIGH', message: 'Termin FIX — brak elastyczności, wysokie ryzyko kary za spóźnienie.' },

  // ── PAYMENT_RISK ──────────────────────────────────────────────────────
  { keyword: 'kompensata', category: 'PAYMENT_RISK', level: 'HIGH', message: 'Kompensata wzajemnych roszczeń — ryzyko potrąceń z wynagrodzenia.' },
  { keyword: 'cesja', category: 'PAYMENT_RISK', level: 'MEDIUM', message: 'Wykryto cesję wierzytelności — sprawdź warunki przelewu.' },
  { keyword: 'faktoring', category: 'PAYMENT_RISK', level: 'LOW', message: 'Faktoring — upewnij się że dotyczy przyspieszenia płatności, nie ukrytych opłat.' },
  { keyword: 'weksel', category: 'PAYMENT_RISK', level: 'HIGH', message: 'Wymagany weksel — poważne ryzyko finansowe, rozważ odmowę.' },
  { keyword: 'przedpłata', category: 'PAYMENT_RISK', level: 'LOW', message: 'Wymieniono przedpłatę — sprawdź warunki i kwotę.' },
  { keyword: 'przelew 90 dni', category: 'PAYMENT_RISK', level: 'HIGH', message: 'Termin płatności 90 dni — bardzo długi okres oczekiwania.' },
  { keyword: 'przelew 120 dni', category: 'PAYMENT_RISK', level: 'HIGH', message: 'Termin płatności 120 dni — ekstremalnie długi okres oczekiwania.' },

  // ── PALLET_EXCHANGE ───────────────────────────────────────────────────
  { keyword: 'wymiana palet', category: 'PALLET_EXCHANGE', level: 'MEDIUM', message: 'Wymagana wymiana palet — upewnij się że kierowca ma odpowiednią liczbę palet.' },
  { keyword: 'palety euro', category: 'PALLET_EXCHANGE', level: 'MEDIUM', message: 'Wymiana palet EURO — zapewnij odpowiedni stan i ilość palet.' },
  { keyword: 'palety zwrotne', category: 'PALLET_EXCHANGE', level: 'MEDIUM', message: 'Palety zwrotne — pamiętaj o organizacji zwrotu.' },
  { keyword: 'kaucja za palety', category: 'PALLET_EXCHANGE', level: 'MEDIUM', message: 'Kaucja za palety — dodatkowy koszt, sprawdź kwotę.' },

  // ── LIABILITY ─────────────────────────────────────────────────────────
  { keyword: 'odpowiedzialność materialna', category: 'LIABILITY', level: 'HIGH', message: 'Pełna odpowiedzialność materialna — sprawdź zakres i limity.' },
  { keyword: 'regres', category: 'LIABILITY', level: 'HIGH', message: 'Prawo do regresu — zleceniodawca może żądać zwrotu kosztów.' },
  { keyword: 'protokół szkody', category: 'LIABILITY', level: 'MEDIUM', message: 'Wymagany protokół szkody — upewnij się że kierowca zna procedurę.' },
  { keyword: 'brak ubezpieczenia', category: 'LIABILITY', level: 'HIGH', message: 'Brak wymaganego ubezpieczenia — sprawdź polisę OCP.' },
  { keyword: 'odpowiedzialność za towar', category: 'LIABILITY', level: 'HIGH', message: 'Rozszerzona odpowiedzialność za towar — sprawdź limity OCP.' },

  // ── DOCUMENTS ─────────────────────────────────────────────────────────
  { keyword: 'oryginał CMR', category: 'DOCUMENTS', level: 'MEDIUM', message: 'Wymagany oryginał CMR — zapewnij prawidłowe wypełnienie i odesłanie.' },
  { keyword: 'pieczątka', category: 'DOCUMENTS', level: 'LOW', message: 'Wymagana pieczątka na dokumentach — upewnij się że kierowca ją posiada.' },
  { keyword: 'potwierdzenie dostawy', category: 'DOCUMENTS', level: 'LOW', message: 'Wymagane potwierdzenie dostawy — przypomni kierowcy o uzyskaniu podpisu.' },
  { keyword: 'list przewozowy', category: 'DOCUMENTS', level: 'LOW', message: 'Wymagany list przewozowy — standardowy dokument transportowy.' },

  // ── SPECIAL_REQUIREMENTS ──────────────────────────────────────────────
  { keyword: 'neutralizacja', category: 'SPECIAL_REQUIREMENTS', level: 'MEDIUM', message: 'Wymagana neutralizacja ładunku — dodatkowy czas i koszty.' },
  { keyword: 'etykietowanie', category: 'SPECIAL_REQUIREMENTS', level: 'MEDIUM', message: 'Wymagane etykietowanie — dodatkowa praca przy załadunku/rozładunku.' },
  { keyword: 'co-loading', category: 'SPECIAL_REQUIREMENTS', level: 'MEDIUM', message: 'Co-loading — ładunek dzielony, sprawdź kompatybilność towarów.' },
  { keyword: 'cross-dock', category: 'SPECIAL_REQUIREMENTS', level: 'LOW', message: 'Cross-docking — przeładunek w magazynie, sprawdź logistykę.' },
  { keyword: 'załadunek boczny', category: 'SPECIAL_REQUIREMENTS', level: 'LOW', message: 'Załadunek boczny — upewnij się że pojazd ma boczne otwarcie.' },
  { keyword: 'winda załadowcza', category: 'SPECIAL_REQUIREMENTS', level: 'LOW', message: 'Wymagana winda załadowcza — sprawdź wyposażenie pojazdu.' },
  { keyword: 'mega trailer', category: 'SPECIAL_REQUIREMENTS', level: 'LOW', message: 'Wymagany mega trailer — sprawdź dostępność odpowiedniego pojazdu.' },
  { keyword: 'podwójna załoga', category: 'SPECIAL_REQUIREMENTS', level: 'MEDIUM', message: 'Wymagana podwójna załoga — dodatkowy koszt kierowcy.' },
  { keyword: 'konwój', category: 'SPECIAL_REQUIREMENTS', level: 'HIGH', message: 'Wymagany konwój — specjalne wymagania bezpieczeństwa, wyższe koszty.' },
  { keyword: 'monitoring GPS', category: 'SPECIAL_REQUIREMENTS', level: 'LOW', message: 'Wymagany monitoring GPS — sprawdź dostępność urządzenia śledzącego.' },
];
