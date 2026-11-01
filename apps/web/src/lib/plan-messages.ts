import {
  formatDate, formatFactor, formatKg, formatMeters, formatMoney, formatTemperatureRange, formatTonnes,
} from './formatting';
import { vehicleCategoryLabel } from './vehicle-categories';

/** Missing load data (API/plan: "weightKg,dimensions") → words in the user's language. */
const LOAD_DATA: Record<Language, Record<string, string>> = {
  pl: { weightKg: 'masy', dimensions: 'wymiarów (długość albo liczba palet)' },
  en: { weightKg: 'weight', dimensions: 'dimensions (length or pallet count)' },
};
function loadDataList(missing: unknown, language: Language): string {
  const and = language === 'pl' ? ' i ' : ' and ';
  return String(missing ?? '').split(',').filter(Boolean).map(m => LOAD_DATA[language][m] ?? m).join(and);
}

/** Emission class from the API (EURO_VI) → "Euro VI". */

/** Counterparty risk criteria (API: "BLACKLIST,PAYMENT") → a phrase in the user's language. */
const RISK_CRITERIA: Record<Language, Record<string, string>> = {
  pl: { BLACKLIST: 'na czarnej liście', PAYMENT: 'niska ocena płatności', RELIABILITY: 'niska rzetelność' },
  en: { BLACKLIST: 'blacklisted', PAYMENT: 'low payment rating', RELIABILITY: 'low reliability' },
};
function riskCriteria(criteria: unknown, language: Language): string {
  return String(criteria ?? '')
    .split(',')
    .filter(Boolean)
    .map(c => RISK_CRITERIA[language][c] ?? c)
    .join(', ');
}

/** Offer fields from the EMAIL_OFFER_FIELDS_MISSING and OFFER_FIELDS_ADMIN_ONLY codes (`fields`: comma-separated keys) → names. */
const OFFER_FIELD_LABELS: Record<Language, Record<string, string>> = {
  pl: {
    pickupCity: 'miasto załadunku', pickupCountry: 'kraj załadunku', deliveryCity: 'miasto rozładunku',
    deliveryCountry: 'kraj rozładunku', pickupDate: 'data załadunku', currency: 'waluta ceny',
    price: 'cena', distanceKm: 'dystans', tollCostEstimate: 'opłaty drogowe', deliveryDate: 'data rozładunku', expiresAt: 'ważność',
    source: 'źródło', externalId: 'identyfikator zewnętrzny',
  },
  en: {
    pickupCity: 'pickup city', pickupCountry: 'pickup country', deliveryCity: 'delivery city',
    deliveryCountry: 'delivery country', pickupDate: 'pickup date', currency: 'price currency',
    price: 'price', distanceKm: 'distance', tollCostEstimate: 'toll', deliveryDate: 'delivery date', expiresAt: 'valid until',
    source: 'source', externalId: 'external id',
  },
};
const offerFieldList = (fields: unknown, language: Language) =>
  String(fields ?? '').split(',').map(f => f.trim()).filter(Boolean).map(f => OFFER_FIELD_LABELS[language][f] ?? f).join(', ');

/** "RIGID, VAN" from the API → "Solówka, Bus / dostawczy" in the user's language. */
const categoryList = (codes: unknown, language: Language) =>
  String(codes ?? '').split(',').map(c => vehicleCategoryLabel(c.trim(), language)).join(', ');

/**
 * Dictionary of the messages that come from the API.
 *
 * The server does not compose sentences — it returns `{ code, params }`. The
 * sentence is built here, in the user's language, with the number formatting
 * of that language.
 *
 * Rule: every API code has a PL and an EN entry. A test that reads the code
 * list straight from the API source guards this — a code added on the server
 * without a translation here turns it red the moment the code appears.
 */

export type Language = 'pl' | 'en';

export interface PlanMessage {
  code: string;
  params?: Record<string, string | number | boolean>;
}

type Template = (p: Record<string, any>) => string;

/** Fleet planning: instants are UTC (tachograph time) — shown with the zone. */
function fleetTime(iso: unknown, language: Language): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '—';
  const text = d.toLocaleString(language === 'pl' ? 'pl-PL' : 'en-GB', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return `${text} UTC`;
}

/** Fleet planning: driver status fields (DRIVER_STATE_ASSUMED `field`). */
const DRIVER_FIELDS: Record<Language, Record<string, string>> = {
  pl: {
    extendedDrivingDaysUsed: 'wykorzystane dni jazdy 10 h w tym tygodniu',
    reducedDailyRestsUsed: 'skrócone odpoczynki dzienne od odpoczynku tygodniowego',
    compensationDueBy: 'termin rekompensaty',
    drivingSinceDailyRestMinutes: 'jazda od odpoczynku dziennego',
    drivingSinceBreakMinutes: 'jazda od przerwy',
    workSinceBreakMinutes: 'praca od przerwy',
  },
  en: {
    extendedDrivingDaysUsed: '10-hour driving days used this week',
    reducedDailyRestsUsed: 'reduced daily rests since the weekly rest',
    compensationDueBy: 'compensation deadline',
    drivingSinceDailyRestMinutes: 'driving since the daily rest',
    drivingSinceBreakMinutes: 'driving since the break',
    workSinceBreakMinutes: 'work since the break',
  },
};
const driverField = (f: unknown, language: Language) => DRIVER_FIELDS[language][String(f)] ?? String(f);

/** MATCH_OFFER_NOT_LIVE reasons → a phrase. */
/**
 * OFFER_STILL_DEAD reasons → a sentence. The loading date and the validity are
 * changed on the "Edytuj ofertę" screen (the offer page) — the sentence points there.
 */
const STILL_DEAD: Record<'pl' | 'en', Record<string, string>> = {
  pl: {
    PICKUP_PASSED: 'Termin załadunku minął — zmień datę załadunku („Edytuj ofertę” na stronie oferty) i przywróć ofertę; albo dodaj ją od nowa.',
    EXPIRED: 'Ważność oferty minęła — zmień ważność („Edytuj ofertę” na stronie oferty) i przywróć ofertę; albo dodaj ją od nowa.',
    TOO_OLD: 'Oferta starsza niż 7 dni — dodaj ją od nowa.',
  },
  en: {
    PICKUP_PASSED: 'The loading date has passed — change the loading date ("Edytuj ofertę" on the offer page) and restore the offer; or add it again.',
    EXPIRED: 'The offer validity has passed — change the validity ("Edytuj ofertę" on the offer page) and restore the offer; or add it again.',
    TOO_OLD: 'The offer is older than 7 days — add it again.',
  },
};

const NOT_LIVE_REASON: Record<'pl' | 'en', Record<string, string>> = {
  pl: { PICKUP_PASSED: 'termin załadunku minął', EXPIRED: 'oferta wygasła', TOO_OLD: 'oferta jest starsza niż 7 dni' },
  en: { PICKUP_PASSED: 'the loading date has passed', EXPIRED: 'the offer has expired', TOO_OLD: 'the offer is older than 7 days' },
};

/** Pola z MATCH_DATA_UNKNOWN (`fields`: klucze po przecinku) → nazwy. */
const MATCH_FIELD_LABELS: Record<Language, Record<string, string>> = {
  pl: {
    weightKg: 'masa ładunku', maxWeightKg: 'ładowność pojazdu', currentCountry: 'kraj, w którym jest pojazd', technicalInspectionTo: 'termin przeglądu',
    insuranceTo: 'termin ubezpieczenia', tachographLegalizationTo: 'termin legalizacji tachografu',
  },
  en: {
    weightKg: 'load weight', maxWeightKg: 'vehicle payload', currentCountry: 'country the vehicle is in', technicalInspectionTo: 'inspection due date',
    insuranceTo: 'insurance expiry', tachographLegalizationTo: 'tachograph calibration due date',
  },
};
const unknownFieldNames = (fields: unknown, language: Language) =>
  String(fields ?? '').split(',').filter(Boolean).map(f => MATCH_FIELD_LABELS[language][f] ?? f).join(', ');

const PL: Record<string, Template> = {
  LOAD_PLAN_LENGTH_EXCEEDED: p =>
    `Przekroczona przestrzeń ładunkowa: ${formatMeters(p.usedM, 'pl')} ` +
    `przy ${formatMeters(p.maxM, 'pl')}.`,
  LOAD_PLAN_WEIGHT_EXCEEDED: p =>
    `Przekroczona ładowność: ${formatKg(p.usedKg, 'pl')} przy ${formatKg(p.maxKg, 'pl')}.`,
  GVW_EXCEEDED: p =>
    `Przekroczone DMC zestawu: ${formatTonnes(p.grossKg, 'pl')} przy ` +
    `${formatTonnes(p.maxGvwKg, 'pl')} — masa własna ${formatTonnes(p.curbKg, 'pl')} ` +
    `plus ładunek ${formatTonnes(p.cargoKg, 'pl')}.`,
  DETOUR_APPROXIMATE: p =>
    `Trasa przybliżona: odległości i nadłożenia liczone z linii prostej × ` +
    `${formatFactor(p.roadFactor, 'pl')}, nie z wyznaczonej trasy.`,
  OFFER_AWAITING_LOCATION: () =>
    'Brak współrzędnych załadunku lub rozładunku — nie da się policzyć objazdu. Oferta wróci do rankingu po ustaleniu lokalizacji.',
  // Offer vs vehicle compatibility
  OFFER_PICKUP_BEFORE_VEHICLE_AVAILABLE: p =>
    `Załadunek ${formatDate(p.pickupDate, 'pl')}, a pojazd jest wolny dopiero od ${formatDate(p.availableFrom, 'pl')}.`,
  OFFER_ADR_VEHICLE_NOT_CERTIFIED: () => 'Ładunek ADR — pojazd nie ma uprawnień ADR.',
  MATCH_VEHICLE_NOT_REEFER: () => 'Ładunek chłodniczy — pojazd nie jest chłodnią.',
  MATCH_VEHICLE_CAPACITY_EXCEEDED: p =>
    `Ładunek ${formatKg(p.weightKg, 'pl')} — ładowność pojazdu ${formatKg(p.maxWeightKg, 'pl')}.`,
  MATCH_VEHICLE_DOCUMENTS_EXPIRED: () => 'Przegląd, ubezpieczenie albo legalizacja tachografu nieważne w dniu załadunku.',
  MATCH_DATA_UNKNOWN: p => `Brak danych: ${unknownFieldNames(p.fields, 'pl')} — bez punktów za tę część oceny.`,
  MATCH_OFFER_NOT_LIVE: p => `Oferta nie jest już aktualna — ${NOT_LIVE_REASON.pl[String(p.reason)] ?? String(p.reason)}. Dopasowanie pokazane tylko do wglądu.`,
  OFFER_ADR_CLASS_NOT_ALLOWED: p =>
    `Klasy ADR oferty (${p.offerClasses}) wykraczają poza klasy pojazdu (${p.vehicleClasses}).`,
  OFFER_ADR_CLASSES_UNKNOWN: p =>
    `Oferta wymaga klas ADR ${p.offerClasses}, a kartoteka pojazdu nie ma spisanych klas — uzupełnij je.`,
  OFFER_ADR_CLASS_UNRECOGNIZED: p =>
    `Nie da się odczytać klasy ADR z oferty („${p.adrClass}") — sprawdź u zleceniodawcy.`,
  OFFER_REQUIRES_REEFER: p => {
    const range = formatTemperatureRange(p.temperatureMin, p.temperatureMax, 'pl');
    return `Ładunek w kontrolowanej temperaturze${range ? ` (${range})` : ''} — pojazd nie jest chłodnią.`;
  },
  OFFER_ADR_CLASS_NOT_GIVEN: () => 'Oferta ADR bez podanej klasy — potwierdź klasę przed przyjęciem.',
  OFFER_TEMPERATURE_UNVERIFIED: p =>
    `Temperatura niezweryfikowana: oferta wymaga ${formatTemperatureRange(p.temperatureMin, p.temperatureMax, 'pl')}, ` +
    `a kartoteka chłodni nie ma zakresu temperatur.`,
  OFFER_PICKUP_TIMEZONE_ASSUMED: p =>
    (p.pickupCountry ? `Nieznany kraj załadunku „${p.pickupCountry}"` : 'Brak kraju załadunku') +
    ` — dzień załadunku liczony w strefie ${p.timeZone}. Sprawdź datę, jeśli kraj jest w innej strefie.`,

  // Fleet — attachments
  VEHICLE_ATTACH_NOT_TOWED: p =>
    `${vehicleCategoryLabel(p.childCategory, 'pl')} nie jest naczepą ani przyczepą — nie da się go podpiąć.`,
  VEHICLE_ATTACH_WRONG_PARENT: p =>
    `${vehicleCategoryLabel(p.childCategory, 'pl')} nie może być podpięta pod: ${vehicleCategoryLabel(p.parentCategory, 'pl')}. ` +
    `Dozwolone: ${categoryList(p.allowedParents, 'pl')}.`,
  VEHICLE_ATTACH_PARENT_NOT_FOUND: () => 'Nie znaleziono pojazdu, pod który ma być podpięty rekord.',
  VEHICLE_CATEGORY_BREAKS_ATTACHMENT: p =>
    `Nie można zmienić kategorii na: ${vehicleCategoryLabel(p.parentCategory, 'pl')} — podpięta ` +
    `${vehicleCategoryLabel(p.childCategory, 'pl').toLowerCase()} ${p.childPlate} może być tylko pod: ` +
    `${categoryList(p.allowedParents, 'pl')}. Najpierw ją odepnij.`,
  COMPANY_CURRENCY_CHANGE_WITHOUT_COST: p =>
    `Koszt kilometra ${formatFactor(p.costPerKm, 'pl')} ${p.fromCurrency} jest w starej walucie. Zmieniając walutę ` +
    `na ${p.toCurrency}, podaj też koszt kilometra w ${p.toCurrency}.`,
  PASSWORD_CURRENT_INVALID: () => 'Obecne hasło jest nieprawidłowe.',
  PASSWORD_UNCHANGED: () => 'Nowe hasło jest takie samo jak obecne.',
  REGISTER_EMAIL_TAKEN: () => 'Konto z tym adresem e-mail już istnieje.',
  REGISTER_TAX_ID_INVALID: () => 'Nieprawidłowy NIP — 10 cyfr z poprawną sumą kontrolną.',
  REGISTRATION_DISABLED: () => 'Rejestracja nowych firm jest wyłączona — konto zakłada administrator systemu.',
  OFFER_COST_ESTIMATED: () => 'Koszt bez trasy z planera — km z oferty × koszt kilometra firmy (szacunek).',
  NEGOTIATION_SAMPLE_TOO_SMALL: p =>
    `Za mało ofert na podobnych trasach do porównania z rynkiem: kontrahent ${p.contractorOffers} (potrzeba ${p.minContractorOffers}), rynek ${p.marketOffers} (potrzeba ${p.minMarketOffers}).`,
  OFFER_COST_WITHOUT_TOLLS: () => 'Koszt bez myta (brak trasy i ręcznego myta) — marża to górna granica.',
  OFFER_COST_NO_DISTANCE: () => 'Brak dystansu — koszt oferty nieznany. Policz trasę w planerze.',
  OFFER_COST_RATE_MISSING: () => 'Firma nie ma kosztu kilometra — koszt oferty nieznany. Administrator ustawia go w ustawieniach firmy.',
  IMPORT_ROW_FIELD_INVALID: p =>
    p.field ? `Wiersz ${Number(p.row) + 1}: pole ${p.field} jest puste, ma zły typ albo nie należy do oferty — wiersz pominięty.` : `Wiersz ${Number(p.row) + 1} nie jest ofertą — pominięty.`,
  IMPORT_ROW_DATE_INVALID: p => `Wiersz ${Number(p.row) + 1}: nieczytelna data w polu ${p.field} — wiersz pominięty.`,
  OFFER_VALUE_OUT_OF_RANGE: p => `Kwota w polu ${p.field} jest poza dozwolonym zakresem (0 – 99 999 999,99)${p.row !== undefined ? ` — wiersz ${Number(p.row) + 1} pominięty` : ''}.`,
  LAST_ACTIVE_ADMIN: () => 'To ostatni aktywny administrator firmy — nie można go dezaktywować.',
  CONCURRENT_CHANGE_RETRY: () => 'Ktoś w tej samej chwili zmienił te dane — spróbuj ponownie.',
  EMAIL_OFFER_EXISTS: () => 'Z tego e-maila utworzono już ofertę — drugiej nie tworzymy.',
  EMAIL_OFFER_FIELDS_MISSING: p =>
    `E-mail nie podaje: ${offerFieldList(p.fields, 'pl')}. Oferty nie utworzono — dodaj ją ręcznie z tymi danymi.`,
  TOLL_PROVIDER_NOT_CONFIGURED: () =>
    'Myto nie jest liczone — nie podłączono dostawcy myta. Koszt i marża są bez myta (niepełne).',
  TOLL_PROVIDER_UNAVAILABLE: p =>
    `Dostawca myta nie odpowiedział poprawnie (${p.reason}) — nic nie zostało policzone ani zapisane.`,
  FX_RATE_STATIC: p =>
    `Przeliczono z ${p.from} na ${p.to} kursem stałym ${formatFactor(p.rate, 'pl')} (nie z NBP).`,
  CURRENCY_CONVERSION_UNAVAILABLE: p =>
    `Brak kursu ${p.from} → ${p.to} — kwoty nie przeliczono, oferta na końcu listy.`,
  TOTAL_EXCLUDES_UNCONVERTED: p =>
    `Bez ${p.count} ofert(y) w ${p.from} — brak kursu na ${p.to}, kwot nie doliczono.`,
  DETOUR_COST_UNKNOWN: () =>
    'Firma nie ma kosztu kilometra — kolejność po przychodzie, nie po zysku. Ustaw koszt w ustawieniach firmy.',
  DETOUR_TOLL_ESTIMATED: p =>
    `Myto nadłożenia oszacowane stawką trasy oferty: ${formatFactor(p.rateEurPerKm, 'pl')} EUR/km (klasa osi ${p.axleClass}).`,
  DETOUR_TOLL_NOT_INCLUDED: p =>
    p.reason === 'VEHICLE_AXLE_CLASS_UNKNOWN'
      ? 'Myto nadłożenia nie jest doliczone: nie znamy klasy osi zestawu (uzupełnij osie w kartotece).'
      : 'Myto nadłożenia nie jest doliczone: trasa oferty nie była policzona w planerze (z dostawcą myta).',
  LOAD_DOES_NOT_COVER_DETOUR: p => `Doładunek nie pokrywa kosztu nadłożenia — strata ${formatMoney(p.loss, String(p.currency), 'pl')}.`,
  OFFER_PRICE_MISSING: () => 'Oferta bez ceny — nie da się policzyć zysku; na końcu listy.',
  OFFER_THRESHOLD_PRICE: p => `Poniżej ${formatMoney(p.amount, String(p.currency), 'pl')} doładunek jest na minusie.`,
  COUNTERPARTY_RISK: p => `Ryzyko kontrahenta: ${riskCriteria(p.criteria, 'pl')}.`,
  OFFER_ASSIGNEE_NOT_FOUND: () => 'Nie znaleziono aktywnego użytkownika w Twojej firmie — oferty nie przypisano.',
  OFFER_ASSIGN_VIA_ASSIGN: () => 'Status „Przypisana” ustawia tylko przypisanie osoby — użyj „Przypisz do mnie”.',
  OFFER_CONTRACTOR_BLACKLISTED: () => 'Kontrahent na czarnej liście firmy — nie przyjmuj bez decyzji kierownika. Przyjąć może tylko administrator.',
  CONTRACTOR_BLACKLIST_ADMIN_ONLY: () => 'Czarną listę i kontrahenta z czarnej listy przy ofercie zmienia tylko administrator.',
  CONTRACTOR_HAS_OFFERS: p => `Kontrahent ma oferty (${String(p.offers)}) — nie można go usunąć. Dezaktywuj go zamiast tego.`,
  OFFER_FIELDS_ADMIN_ONLY: p => `Oferta jest przyjęta, w drodze albo zakończona — te pola zmienia tylko administrator: ${offerFieldList(p.fields, 'pl')}.`,
  OFFER_FIELD_NOT_EDITABLE: p => `Tego pola oferty nie można zmienić (${offerFieldList(p.field, 'pl')}) — to pochodzenie oferty i klucz importu.`,
  OFFER_STILL_DEAD: p => STILL_DEAD.pl[String(p.reason)] ?? `Oferta nie jest już aktualna (${String(p.reason)}) — dodaj ją od nowa.`,
  OFFER_CONTRACTOR_NOT_FOUND: () => 'Nie znaleziono kontrahenta w Twojej firmie.',
  VEHICLE_DISPATCHER_NOT_FOUND: () => 'Nie znaleziono spedytora w Twojej firmie.',
  DRIVER_STATE_ASSUMED: p =>
    `Brak danych: ${driverField(p.field, 'pl')} — przyjęto najmniej korzystną wartość (${p.value}). Uzupełnij stan kierowcy.`,
  DRIVER_STATUS_STALE: p =>
    `Stan kierowcy z ${fleetTime(p.asOf, 'pl')} ma ponad 7 dni — liczniki mogą być nieaktualne.`,
  BREAK_MISSING: p =>
    `Brak przerwy 45 min po 4,5 h jazdy (od ${fleetTime(p.at, 'pl')}).`,
  DAILY_DRIVING_EXCEEDED: p =>
    `Przekroczony dzienny czas jazdy (${Number(p.limitMinutes) / 60} h) od ${fleetTime(p.at, 'pl')}.`,
  WEEKLY_DRIVING_EXCEEDED: p =>
    `Ponad 56 h jazdy w tygodniu (od ${fleetTime(p.at, 'pl')}).`,
  FORTNIGHT_DRIVING_EXCEEDED: p =>
    `Ponad 90 h jazdy w dwóch kolejnych tygodniach (od ${fleetTime(p.at, 'pl')}).`,
  DAILY_REST_LATE: p =>
    `Odpoczynek dzienny za późno — musiał zacząć się do ${fleetTime(p.at, 'pl')} (24 h od końca poprzedniego odpoczynku).`,
  REDUCED_DAILY_RESTS_EXCEEDED: p =>
    `Ponad trzy skrócone odpoczynki dzienne między odpoczynkami tygodniowymi (${fleetTime(p.at, 'pl')}).`,
  WEEKLY_REST_LATE: p =>
    `Odpoczynek tygodniowy musiał zacząć się do ${fleetTime(p.at, 'pl')} (6 × 24 h od poprzedniego).`,
  CONSECUTIVE_REDUCED_WEEKLY_RESTS: p =>
    `Dwa skrócone odpoczynki tygodniowe z rzędu (${fleetTime(p.at, 'pl')}) — po skróconym musi być regularny.`,
  WEEKLY_REST_EXCEPTION_APPLIED: () =>
    `Dwa skrócone odpoczynki tygodniowe za granicą z rzędu — dozwolone (wyjątek dla transportu międzynarodowego). Przed następnym tygodniowym rekompensata za oba.`,
  WEEKLY_REST_EXCEPTION_UNVERIFIABLE: () =>
    'Wyjątku dla dwóch skróconych odpoczynków za granicą nie da się sprawdzić: w stanie kierowcy brak listy ostatnich odpoczynków tygodniowych.',
  COMPENSATION_OVERDUE: p =>
    `Rekompensata za skrócony odpoczynek tygodniowy nie odebrana do ${fleetTime(p.at, 'pl')}.`,
  COMPENSATION_INVALID: p =>
    `Rekompensata dołączona do odpoczynku krótszego niż 9 h (${fleetTime(p.at, 'pl')}).`,
  COMPENSATION_NOT_BEFORE_WEEKLY_REST: p =>
    `Przed odpoczynkiem tygodniowym ${fleetTime(p.at, 'pl')} należało odebrać rekompensatę za dwa skrócone.`,
  WEEKLY_REST_IN_CAB: p =>
    `Regularny odpoczynek tygodniowy w kabinie (${fleetTime(p.at, 'pl')}) — niedozwolone, potrzebny nocleg.`,
  WEEKLY_REST_ACCOMMODATION_REQUIRED: p =>
    `Odpoczynek tygodniowy ${p.hours} h poza domem od ${fleetTime(p.at, 'pl')} — nocleg poza kabiną (koszt).`,
  HOME_RETURN_LATE: p =>
    `Kierowca powinien móc zacząć odpoczynek w domu do ${fleetTime(p.at, 'pl')} — plan tego nie umożliwia.`,
  HOME_RETURN_DECLINED: p =>
    `Termin odpoczynku w domu (${fleetTime(p.at, 'pl')}) — kierowca wybrał pozostanie poza domem.`,
  DRIVER_NOT_FOUND: () =>
    'Nie znaleziono kierowcy w Twojej firmie.',
  DRIVER_VEHICLE_NOT_FOUND: () =>
    'Nie znaleziono pojazdu w Twojej firmie.',
  DRIVER_VEHICLE_NOT_A_POWER_UNIT: p =>
    `Kierowcę przypisuje się do pojazdu z napędem, nie do ${p.vehicleCategory === 'TRAILER' ? 'przyczepy' : 'naczepy'}.`,
  DRIVER_VEHICLE_ALREADY_ASSIGNED: () =>
    'Ten pojazd ma już przypisanego kierowcę (jedna obsada).',
  DRIVER_STATUS_INVALID: p =>
    `Stan kierowcy niespójny: ${p.field}.`,
  DRIVER_STATUS_MISSING: () =>
    'Brak stanu kierowcy — wprowadź go, żeby policzyć dostępność.',
  DRIVER_STATUS_INCOMPLETE: p =>
    `Stan kierowcy ze źródła danych jest niepełny: brak ${p.field}.`,
  DRIVER_ACTIVITY_PROVIDER_FAILED: p =>
    `Źródło danych o czasie pracy kierowcy nie odpowiedziało poprawnie (${p.reason}). Spróbuj ponownie albo wprowadź stan ręcznie.`,
  TIMOCOM_NOT_IMPLEMENTED: () =>
    'Publikacja na Timocom nie jest dostępna w tej instalacji — oferta nie została wysłana.',
  TASK_CANNOT_FIT_LEGALLY: p =>
    `Zadanie nr ${Number(p.taskIndex) + 1} nie mieści się legalnie (za długie na jedną zmianę albo bez przerwy) — wstawione od ${fleetTime(p.at, 'pl')}, do decyzji dyspozytora.`,
  WTD_BREAK_MISSING: p =>
    `Brak przerwy w czasie pracy (${p.rule === 'OVER_9H' ? 'łącznie 45 min przy ponad 9 h pracy' : p.rule === 'OVER_6H' ? 'łącznie 30 min przy ponad 6 h pracy' : 'ponad 6 h pracy bez przerwy'}) od ${fleetTime(p.at, 'pl')}.`,
  LOAD_PLAN_OFFER_INCOMPLETE: p =>
    `Nie dodano do planu: brak ${loadDataList(p.missing, 'pl')} — uzupełnij ofertę, żeby policzyć zajętość i DMC.`,
  ROUTE_GEOCODING_FAILED: p =>
    `Nie udało się ustalić położenia: ${p.places}. Sprawdź pisownię (np. „Poznań, PL”) ` +
    'albo spróbuj ponownie za chwilę — to nie znaczy, że nie ma ofert.',
  ROUTE_ESTIMATED: () => 'Trasa szacunkowa — serwis tras był niedostępny; odległość z tabeli węzłów. Nie zapisano jej przy ofercie.',
  ROUTE_UNAVAILABLE: () => 'Nie udało się policzyć trasy (serwis tras niedostępny, brak szacunku dla tych miejsc). Spróbuj ponownie za chwilę.',
};

const EN: Record<string, Template> = {
  LOAD_PLAN_LENGTH_EXCEEDED: p =>
    `Loading space exceeded: ${formatMeters(p.usedM, 'en')} against ` +
    `${formatMeters(p.maxM, 'en')}.`,
  LOAD_PLAN_WEIGHT_EXCEEDED: p =>
    `Payload exceeded: ${formatKg(p.usedKg, 'en')} against ${formatKg(p.maxKg, 'en')}.`,
  GVW_EXCEEDED: p =>
    `Gross vehicle weight exceeded: ${formatTonnes(p.grossKg, 'en')} against ` +
    `${formatTonnes(p.maxGvwKg, 'en')} — kerb weight ${formatTonnes(p.curbKg, 'en')} ` +
    `plus cargo ${formatTonnes(p.cargoKg, 'en')}.`,
  DETOUR_APPROXIMATE: p =>
    `Approximate route: distances and detours from a straight line × ` +
    `${formatFactor(p.roadFactor, 'en')}, not from a planned route.`,
  OFFER_AWAITING_LOCATION: () =>
    'No coordinates for loading or unloading — the detour cannot be calculated. The offer returns to the ranking once it is located.',
  // Offer vs vehicle compatibility
  OFFER_PICKUP_BEFORE_VEHICLE_AVAILABLE: p =>
    `Loading on ${formatDate(p.pickupDate, 'en')}, but the vehicle is only free from ${formatDate(p.availableFrom, 'en')}.`,
  OFFER_ADR_VEHICLE_NOT_CERTIFIED: () => 'ADR cargo — the vehicle has no ADR approval.',
  MATCH_VEHICLE_NOT_REEFER: () => 'Reefer cargo — the vehicle is not a reefer.',
  MATCH_VEHICLE_CAPACITY_EXCEEDED: p =>
    `Load ${formatKg(p.weightKg, 'en')} — vehicle payload ${formatKg(p.maxWeightKg, 'en')}.`,
  MATCH_VEHICLE_DOCUMENTS_EXPIRED: () => 'The inspection, insurance or tachograph calibration is not valid on the day of loading.',
  MATCH_DATA_UNKNOWN: p => `No data: ${unknownFieldNames(p.fields, 'en')} — no points for that part of the score.`,
  MATCH_OFFER_NOT_LIVE: p => `The offer is no longer live — ${NOT_LIVE_REASON.en[String(p.reason)] ?? String(p.reason)}. The match is shown for reference only.`,
  OFFER_ADR_CLASS_NOT_ALLOWED: p =>
    `The offer's ADR classes (${p.offerClasses}) go beyond the vehicle's classes (${p.vehicleClasses}).`,
  OFFER_ADR_CLASSES_UNKNOWN: p =>
    `The offer needs ADR classes ${p.offerClasses}, but the vehicle record lists no classes — fill them in.`,
  OFFER_ADR_CLASS_UNRECOGNIZED: p =>
    `The offer's ADR class cannot be read ("${p.adrClass}") — check with the shipper.`,
  OFFER_REQUIRES_REEFER: p => {
    const range = formatTemperatureRange(p.temperatureMin, p.temperatureMax, 'en');
    return `Temperature-controlled cargo${range ? ` (${range})` : ''} — the vehicle is not a reefer.`;
  },
  OFFER_ADR_CLASS_NOT_GIVEN: () => 'ADR offer without a class — confirm the class before accepting.',
  OFFER_TEMPERATURE_UNVERIFIED: p =>
    `Temperature not verified: the offer needs ${formatTemperatureRange(p.temperatureMin, p.temperatureMax, 'en')}, ` +
    `but the reefer's record has no temperature range.`,
  OFFER_PICKUP_TIMEZONE_ASSUMED: p =>
    (p.pickupCountry ? `Unknown loading country "${p.pickupCountry}"` : 'No loading country') +
    ` — the loading day is judged in ${p.timeZone}. Check the date if the country is in another zone.`,

  // Fleet — attachments
  VEHICLE_ATTACH_NOT_TOWED: p =>
    `A ${vehicleCategoryLabel(p.childCategory, 'en').toLowerCase()} is neither a semi-trailer nor a trailer — it cannot be attached.`,
  VEHICLE_ATTACH_WRONG_PARENT: p =>
    `A ${vehicleCategoryLabel(p.childCategory, 'en').toLowerCase()} cannot be attached to: ${vehicleCategoryLabel(p.parentCategory, 'en')}. ` +
    `Allowed: ${categoryList(p.allowedParents, 'en')}.`,
  VEHICLE_ATTACH_PARENT_NOT_FOUND: () => 'The vehicle this record should be attached to was not found.',
  VEHICLE_CATEGORY_BREAKS_ATTACHMENT: p =>
    `Cannot change the category to: ${vehicleCategoryLabel(p.parentCategory, 'en')} — the attached ` +
    `${vehicleCategoryLabel(p.childCategory, 'en').toLowerCase()} ${p.childPlate} may only be attached to: ` +
    `${categoryList(p.allowedParents, 'en')}. Detach it first.`,
  COMPANY_CURRENCY_CHANGE_WITHOUT_COST: p =>
    `The cost per km ${formatFactor(p.costPerKm, 'en')} ${p.fromCurrency} is in the old currency. When changing the ` +
    `currency to ${p.toCurrency}, also give the cost per km in ${p.toCurrency}.`,
  PASSWORD_CURRENT_INVALID: () => 'The current password is incorrect.',
  PASSWORD_UNCHANGED: () => 'The new password is the same as the current one.',
  REGISTER_EMAIL_TAKEN: () => 'An account with this e-mail address already exists.',
  REGISTER_TAX_ID_INVALID: () => 'Invalid Polish tax ID (NIP) — 10 digits with a valid check digit.',
  REGISTRATION_DISABLED: () => 'Registering new companies is turned off — the system administrator creates accounts.',
  OFFER_COST_ESTIMATED: () => 'Cost without a planner route — offer km × the company cost per km (an estimate).',
  NEGOTIATION_SAMPLE_TOO_SMALL: p =>
    `Too few offers on similar routes to compare with the market: contractor ${p.contractorOffers} (needs ${p.minContractorOffers}), market ${p.marketOffers} (needs ${p.minMarketOffers}).`,
  OFFER_COST_WITHOUT_TOLLS: () => 'Cost without tolls (no route and no manual toll) — the margin is an upper bound.',
  OFFER_COST_NO_DISTANCE: () => 'No distance — the offer cost is unknown. Calculate the route in the planner.',
  OFFER_COST_RATE_MISSING: () => 'The company has no cost per km — the offer cost is unknown. An administrator sets it in the company settings.',
  IMPORT_ROW_FIELD_INVALID: p =>
    p.field ? `Row ${Number(p.row) + 1}: field ${p.field} is empty, has the wrong type or is not part of an offer — row skipped.` : `Row ${Number(p.row) + 1} is not an offer — skipped.`,
  IMPORT_ROW_DATE_INVALID: p => `Row ${Number(p.row) + 1}: unreadable date in ${p.field} — row skipped.`,
  OFFER_VALUE_OUT_OF_RANGE: p => `The amount in ${p.field} is out of the allowed range (0 – 99,999,999.99)${p.row !== undefined ? ` — row ${Number(p.row) + 1} skipped` : ''}.`,
  LAST_ACTIVE_ADMIN: () => 'This is the company\'s last active administrator — it cannot be deactivated.',
  CONCURRENT_CHANGE_RETRY: () => 'Someone changed the same data at the same moment — please try again.',
  EMAIL_OFFER_EXISTS: () => 'An offer was already created from this e-mail — no second one.',
  EMAIL_OFFER_FIELDS_MISSING: p =>
    `The e-mail does not give: ${offerFieldList(p.fields, 'en')}. No offer was created — add it manually with these details.`,
  TOLL_PROVIDER_NOT_CONFIGURED: () =>
    'Toll is not computed — no toll provider is connected. Cost and margin exclude toll (incomplete).',
  TOLL_PROVIDER_UNAVAILABLE: p =>
    `The toll provider failed (${p.reason}) — nothing was computed or saved.`,
  FX_RATE_STATIC: p =>
    `Converted from ${p.from} to ${p.to} at a fixed rate of ${formatFactor(p.rate, 'en')} (not from the central bank).`,
  CURRENCY_CONVERSION_UNAVAILABLE: p =>
    `No ${p.from} → ${p.to} rate — the amount was not converted; the offer is at the end of the list.`,
  TOTAL_EXCLUDES_UNCONVERTED: p =>
    `Excludes ${p.count} offer(s) in ${p.from} — no rate to ${p.to}, the amounts were not added.`,
  DETOUR_COST_UNKNOWN: () =>
    'The company has no cost per km — ordered by revenue, not profit. Set the cost in the company settings.',
  DETOUR_TOLL_ESTIMATED: p =>
    `Detour toll estimated at the offer route's rate: ${formatFactor(p.rateEurPerKm, 'en')} EUR/km (axle class ${p.axleClass}).`,
  DETOUR_TOLL_NOT_INCLUDED: p =>
    p.reason === 'VEHICLE_AXLE_CLASS_UNKNOWN'
      ? 'Detour toll not included: the combination axle class is unknown (fill in the axles in the fleet).'
      : 'Detour toll not included: the offer route was not calculated in the planner (with a toll provider).',
  LOAD_DOES_NOT_COVER_DETOUR: p => `The load does not cover the detour cost — a loss of ${formatMoney(p.loss, String(p.currency), 'en')}.`,
  OFFER_PRICE_MISSING: () => 'No price on the offer — profit cannot be calculated; at the end of the list.',
  OFFER_THRESHOLD_PRICE: p => `Below ${formatMoney(p.amount, String(p.currency), 'en')} the extra load runs at a loss.`,
  COUNTERPARTY_RISK: p => `Counterparty risk: ${riskCriteria(p.criteria, 'en')}.`,
  OFFER_ASSIGNEE_NOT_FOUND: () => 'No active user in your company was found — the offer was not assigned.',
  OFFER_ASSIGN_VIA_ASSIGN: () => 'The "Assigned" status is set only by assigning a person — use "Assign to me".',
  OFFER_CONTRACTOR_BLACKLISTED: () => 'The contractor is on the company blacklist — do not accept without a manager\'s decision. Only an administrator can accept.',
  CONTRACTOR_BLACKLIST_ADMIN_ONLY: () => 'Only an administrator can change the blacklist, or a blacklisted contractor on an offer.',
  CONTRACTOR_HAS_OFFERS: p => `The contractor has offers (${String(p.offers)}) — it cannot be deleted. Deactivate it instead.`,
  OFFER_FIELDS_ADMIN_ONLY: p => `The offer is accepted, in transit or completed — only an administrator can change: ${offerFieldList(p.fields, 'en')}.`,
  OFFER_FIELD_NOT_EDITABLE: p => `This offer field cannot be changed (${offerFieldList(p.field, 'en')}) — it is the offer's origin and import key.`,
  OFFER_STILL_DEAD: p => STILL_DEAD.en[String(p.reason)] ?? `The offer is no longer live (${String(p.reason)}) — add it again.`,
  OFFER_CONTRACTOR_NOT_FOUND: () => 'No contractor in your company was found.',
  VEHICLE_DISPATCHER_NOT_FOUND: () => 'No dispatcher in your company was found.',
  DRIVER_STATE_ASSUMED: p =>
    `Missing: ${driverField(p.field, 'en')} — the least favourable value was assumed (${p.value}). Complete the driver status.`,
  DRIVER_STATUS_STALE: p =>
    `The driver status from ${fleetTime(p.asOf, 'en')} is more than 7 days old — its counters may be out of date.`,
  BREAK_MISSING: p =>
    `No 45-min break after 4.5 h of driving (from ${fleetTime(p.at, 'en')}).`,
  DAILY_DRIVING_EXCEEDED: p =>
    `Daily driving time exceeded (${Number(p.limitMinutes) / 60} h) from ${fleetTime(p.at, 'en')}.`,
  WEEKLY_DRIVING_EXCEEDED: p =>
    `More than 56 h of driving in the week (from ${fleetTime(p.at, 'en')}).`,
  FORTNIGHT_DRIVING_EXCEEDED: p =>
    `More than 90 h of driving in two consecutive weeks (from ${fleetTime(p.at, 'en')}).`,
  DAILY_REST_LATE: p =>
    `Daily rest too late — it had to start by ${fleetTime(p.at, 'en')} (24 h after the previous rest).`,
  REDUCED_DAILY_RESTS_EXCEEDED: p =>
    `More than three reduced daily rests between weekly rests (${fleetTime(p.at, 'en')}).`,
  WEEKLY_REST_LATE: p =>
    `The weekly rest had to start by ${fleetTime(p.at, 'en')} (6 × 24 h after the previous one).`,
  CONSECUTIVE_REDUCED_WEEKLY_RESTS: p =>
    `Two reduced weekly rests in a row (${fleetTime(p.at, 'en')}) — a reduced one must be followed by a regular one.`,
  WEEKLY_REST_EXCEPTION_APPLIED: () =>
    `Two consecutive reduced weekly rests abroad — allowed (international exception). Both compensations before the next weekly rest.`,
  WEEKLY_REST_EXCEPTION_UNVERIFIABLE: () =>
    'The exception for two reduced rests abroad cannot be checked: the driver status has no list of recent weekly rests.',
  COMPENSATION_OVERDUE: p =>
    `Compensation for a reduced weekly rest not taken by ${fleetTime(p.at, 'en')}.`,
  COMPENSATION_INVALID: p =>
    `Compensation attached to a rest shorter than 9 h (${fleetTime(p.at, 'en')}).`,
  COMPENSATION_NOT_BEFORE_WEEKLY_REST: p =>
    `The compensation for the two reduced rests was due before the weekly rest at ${fleetTime(p.at, 'en')}.`,
  WEEKLY_REST_IN_CAB: p =>
    `Regular weekly rest in the cab (${fleetTime(p.at, 'en')}) — not allowed, accommodation needed.`,
  WEEKLY_REST_ACCOMMODATION_REQUIRED: p =>
    `Weekly rest of ${p.hours} h away from home from ${fleetTime(p.at, 'en')} — accommodation outside the cab (cost).`,
  HOME_RETURN_LATE: p =>
    `The driver should be able to start a rest at home by ${fleetTime(p.at, 'en')} — the plan does not allow it.`,
  HOME_RETURN_DECLINED: p =>
    `Home rest due by ${fleetTime(p.at, 'en')} — the driver chose to stay away.`,
  DRIVER_NOT_FOUND: () =>
    'No such driver in your company.',
  DRIVER_VEHICLE_NOT_FOUND: () =>
    'No such vehicle in your company.',
  DRIVER_VEHICLE_NOT_A_POWER_UNIT: p =>
    `A driver is assigned to a power unit, not to a ${p.vehicleCategory === 'TRAILER' ? 'trailer' : 'semi-trailer'}.`,
  DRIVER_VEHICLE_ALREADY_ASSIGNED: () =>
    'This vehicle already has a driver (single crew).',
  DRIVER_STATUS_INVALID: p =>
    `Driver status is inconsistent: ${p.field}.`,
  DRIVER_STATUS_MISSING: () =>
    'No driver status yet — enter one to compute availability.',
  DRIVER_STATUS_INCOMPLETE: p =>
    `The driver status from the data source is incomplete: ${p.field} is missing.`,
  DRIVER_ACTIVITY_PROVIDER_FAILED: p =>
    `The driver working-time source did not answer properly (${p.reason}). Try again or enter the status by hand.`,
  TIMOCOM_NOT_IMPLEMENTED: () =>
    'Publishing on Timocom is not available in this installation — the offer was not sent.',
  TASK_CANNOT_FIT_LEGALLY: p =>
    `Task ${Number(p.taskIndex) + 1} cannot be placed legally (too long for one duty or one work run) — placed from ${fleetTime(p.at, 'en')}, for the dispatcher to decide.`,
  WTD_BREAK_MISSING: p =>
    `Working-time break missing (${p.rule === 'OVER_9H' ? '45 min in total over 9 h of work' : p.rule === 'OVER_6H' ? '30 min in total over 6 h of work' : 'over 6 h of work without a break'}) from ${fleetTime(p.at, 'en')}.`,
  LOAD_PLAN_OFFER_INCOMPLETE: p =>
    `Not added to the plan: missing ${loadDataList(p.missing, 'en')} — complete the offer to check load space and GVW.`,
  ROUTE_GEOCODING_FAILED: p =>
    `Could not locate: ${p.places}. Check the spelling (e.g. “Poznań, PL”) ` +
    'or try again in a moment — this does not mean there are no offers.',
  ROUTE_ESTIMATED: () => 'An estimated route — the routing service was unavailable; the distance comes from the hub table. Not saved with the offer.',
  ROUTE_UNAVAILABLE: () => 'The route could not be calculated (the routing service is unavailable and there is no estimate for these places). Try again in a moment.',
};

export const MESSAGES: Record<Language, Record<string, Template>> = { pl: PL, en: EN };

/**
 * The sentence for an API message.
 *
 * An unknown code returns the code itself — the screen does not go blank, and
 * the gap cannot be missed, because `GVW_EXCEEDED` shows instead of a sentence.
 */
export function messageText(message: PlanMessage, language: Language = 'pl'): string {
  const template = MESSAGES[language]?.[message.code] ?? MESSAGES.pl[message.code];
  if (!template) return message.code;
  return template(message.params ?? {});
}

/**
 * List of messages → list of sentences.
 *
 * Exists so that a screen never puts an API object straight into JSX.
 * `{w}` instead of `{messageText(w)}` prints "[object Object]": nothing
 * fails, nothing turns red, and the forwarder sees it on the screen.
 * A separate function gives this one place, and one place to check.
 */
export function messagesToText(
  messages: readonly PlanMessage[],
  language: Language = 'pl',
): string[] {
  return messages.map(m => messageText(m, language));
}
