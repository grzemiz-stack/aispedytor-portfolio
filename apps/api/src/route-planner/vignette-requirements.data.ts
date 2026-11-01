/**
 * Vignette / OBU requirements by country (EU plus CH and NO) — static reference data (Layer 0).
 *
 * For each country: whether an electronic on-board unit (OBU), a vignette or a
 * registration is required for trucks (>3.5 t / >7.5 t / >12 t).
 * Description only — no toll amounts. Each entry records when it was last
 * verified and its source (`lastVerified`, `source`; all entries: 2025-01-15).
 */

// ─── Types ───────────────────────────────────────────────────────────

export type TollSystemType = 'GPS_OBU' | 'DSRC_OBU' | 'vignette' | 'manual_toll' | 'none';

export interface PurchaseInfo {
  onlineUrl?: string;
  physicalLocations: string[];
}

export interface VignetteRequirement {
  countryCode: string;
  name: string;
  required: boolean;
  systemType: TollSystemType;
  systemName: string;
  appliesTo: string;
  obuDevice?: string;
  penalty: { amount: number; currency: string; description: string };
  purchase: PurchaseInfo;
  acceptedPayment: string[];
  acceptedFuelCards: string[];
  interoperableWith?: string[];
  notes?: string;
  lastVerified: string;
  source: string;
}

// ─── Vignette / OBU data ────────────────────────────────────────────

export const VIGNETTE_REQUIREMENTS: Record<string, VignetteRequirement> = {
  DE: {
    countryCode: 'DE',
    name: 'Deutschland',
    required: true,
    systemType: 'GPS_OBU',
    systemName: 'Toll Collect',
    appliesTo: 'Pojazdy >7,5t DMC na wszystkich autostradach i drogach federalnych',
    obuDevice: 'Toll Collect OBU (free loan)',
    penalty: { amount: 480, currency: 'EUR', description: 'Kara za brak opłaty + opłata wsteczna za przejechany dystans' },
    purchase: {
      onlineUrl: 'https://www.toll-collect.de/de/toll_collect/registrierung/registrierung.html',
      physicalLocations: ['Stacje obsługi Toll Collect', 'Terminale graniczne', 'Partnerzy serwisowi DKV/UTA'],
    },
    acceptedPayment: ['Polecenie zapłaty', 'Karta kredytowa', 'Karta paliwowa', 'Gwarancja bankowa'],
    acceptedFuelCards: ['DKV', 'UTA', 'AS24', 'Euroshell', 'E100', 'Aral'],
    notes: 'OBU udostępniane bezpłatnie przez Toll Collect. Wymagana rejestracja przed pierwszym użyciem. Rezerwacja ręczna możliwa przez aplikację/terminal dla użytkowników okazjonalnych.',
    lastVerified: '2025-01-15',
    source: 'https://www.toll-collect.de',
  },

  AT: {
    countryCode: 'AT',
    name: 'Österreich',
    required: true,
    systemType: 'DSRC_OBU',
    systemName: 'GO-Maut (ASFINAG)',
    appliesTo: 'Pojazdy >3,5t DMC na wszystkich autostradach i drogach ekspresowych',
    obuDevice: 'GO-Box (DSRC/microwave)',
    penalty: { amount: 240, currency: 'EUR', description: 'Ersatzmaut (opłata zastępcza) na miejscu; do 3000 EUR przy odwołaniu' },
    purchase: {
      onlineUrl: 'https://www.asfinag.at/maut/go-maut/',
      physicalLocations: ['Punkty obsługi ASFINAG GO', 'Graniczne punkty sprzedaży GO', 'Stacje paliw (A1, OMV, Shell, BP)'],
    },
    acceptedPayment: ['Karta kredytowa', 'Karta paliwowa', 'Konto prepaid'],
    acceptedFuelCards: ['DKV', 'UTA', 'AS24', 'Euroshell', 'E100', 'IQ Card'],
    interoperableWith: ['TELEPASS (IT)'],
    notes: 'GO-Box kosztuje ~5 EUR. Musi być zarejestrowany na numer rejestracyjny pojazdu. Akceptowane również OBU TELEPASS EU.',
    lastVerified: '2025-01-15',
    source: 'https://www.asfinag.at/',
  },

  FR: {
    countryCode: 'FR',
    name: 'France',
    required: false,
    systemType: 'manual_toll',
    systemName: 'Péage (toll stations)',
    appliesTo: 'Wszystkie pojazdy na płatnych autostradach (autoroutes concédées)',
    obuDevice: 'TIS-PL (Telepass) OBU optional for non-stop passage',
    penalty: { amount: 375, currency: 'EUR', description: 'Kara za unikanie opłat; pojazd może zostać unieruchomiony' },
    purchase: {
      onlineUrl: 'https://www.bipandgo.com/',
      physicalLocations: ['Pasy gotówkowe na bramkach', 'Stacje obsługi', 'Rejestracja online TIS-PL'],
    },
    acceptedPayment: ['Gotówka', 'Karta kredytowa', 'TIS-PL OBU', 'Telepass EU'],
    acceptedFuelCards: ['DKV', 'UTA', 'AS24', 'Euroshell', 'Total Card'],
    interoperableWith: ['TELEPASS (IT)', 'VIA-T (ES)'],
    notes: 'OBU nie wymagane — płatność na bramkach. Urządzenie TIS-PL/Telepass dostępne do bezstopowego przejazdu. Nie wszystkie autostrady są płatne (odcinki miejskie często bezpłatne).',
    lastVerified: '2025-01-15',
    source: 'https://www.autoroutes.fr/',
  },

  PL: {
    countryCode: 'PL',
    name: 'Polska',
    required: true,
    systemType: 'GPS_OBU',
    systemName: 'e-TOLL',
    appliesTo: 'Pojazdy >3,5t DMC na płatnych autostradach i drogach ekspresowych',
    obuDevice: 'e-TOLL OBU (ZSL device) or e-TOLL PL app (GPS-based)',
    penalty: { amount: 1500, currency: 'PLN', description: 'Kara za jazdę bez aktywnego e-TOLL. Pojazd może zostać zatrzymany.' },
    purchase: {
      onlineUrl: 'https://etoll.gov.pl/',
      physicalLocations: ['Terminale ZSL na przejściach granicznych', 'Stacje paliw (Orlen, BP, Shell)', 'MOP-y'],
    },
    acceptedPayment: ['Konto prepaid', 'Karta kredytowa', 'Karta paliwowa', 'Przelew bankowy'],
    acceptedFuelCards: ['DKV', 'UTA', 'E100', 'Euroshell', 'AS24', 'Orlen Card'],
    notes: 'System oparty na GPS od grudnia 2021. Aplikacja mobilna (e-TOLL PL) może służyć jako wirtualne OBU. Wymagane saldo prepaid przed jazdą.',
    lastVerified: '2025-01-15',
    source: 'https://etoll.gov.pl/',
  },

  CZ: {
    countryCode: 'CZ',
    name: 'Česká republika',
    required: true,
    systemType: 'DSRC_OBU',
    systemName: 'e-Myto (CzechToll)',
    appliesTo: 'Pojazdy >3,5t DMC na autostradach i drogach I klasy',
    obuDevice: 'CzechToll OBU (Billien unit)',
    penalty: { amount: 100000, currency: 'CZK', description: 'Do 100 000 CZK kary; minimum na miejscu: 5 000 CZK' },
    purchase: {
      onlineUrl: 'https://www.mytocz.eu/',
      physicalLocations: ['Punkty dystrybucji/kontaktu CzechToll', 'Przejścia graniczne', 'Wybrane stacje paliw'],
    },
    acceptedPayment: ['Konto prepaid', 'Postpaid (z gwarancją)', 'Karta paliwowa'],
    acceptedFuelCards: ['DKV', 'UTA', 'E100', 'Euroshell', 'AS24'],
    notes: 'System satelitarny. Urządzenie OBU Billien wydawane przy rejestracji. Wymagane konto prepaid lub postpaid.',
    lastVerified: '2025-01-15',
    source: 'https://www.mytocz.eu/',
  },

  SK: {
    countryCode: 'SK',
    name: 'Slovenská republika',
    required: true,
    systemType: 'DSRC_OBU',
    systemName: 'e-Myto (SkyToll)',
    appliesTo: 'Pojazdy >3,5t DMC na autostradach, drogach ekspresowych i wybranych drogach I klasy',
    obuDevice: 'SkyToll OBU (DSRC)',
    penalty: { amount: 1650, currency: 'EUR', description: 'Kara na miejscu do 1 650 EUR za unikanie opłat' },
    purchase: {
      onlineUrl: 'https://www.emyto.sk/',
      physicalLocations: ['Centra obsługi klienta SkyToll', 'Przejścia graniczne', 'Wybrane stacje paliw'],
    },
    acceptedPayment: ['Prepaid', 'Postpaid (gwarancja bankowa)', 'Karta paliwowa'],
    acceptedFuelCards: ['DKV', 'UTA', 'E100', 'Euroshell'],
    notes: 'OBU DSRC mikrofalowe. Wymagana rejestracja i depozyt.',
    lastVerified: '2025-01-15',
    source: 'https://www.emyto.sk/',
  },

  HU: {
    countryCode: 'HU',
    name: 'Magyarország',
    required: true,
    systemType: 'GPS_OBU',
    systemName: 'HU-GO',
    appliesTo: 'Pojazdy >3,5t DMC na autostradach, drogach ekspresowych i głównych',
    obuDevice: 'HU-GO OBU or Route Ticket (single trip)',
    penalty: { amount: 165000, currency: 'HUF', description: '~430 EUR kary na miejscu; wyższa przy odwołaniu' },
    purchase: {
      onlineUrl: 'https://www.hu-go.hu/',
      physicalLocations: ['Punkty obsługi klienta HU-GO', 'Stacje paliw (MOL, Shell)', 'Graniczne punkty poboru opłat'],
    },
    acceptedPayment: ['Saldo prepaid', 'Postpaid (gwarancja bankowa)', 'Bilet trasowy (zakupiony z wyprzedzeniem)'],
    acceptedFuelCards: ['DKV', 'UTA', 'E100', 'MOL Group Card'],
    notes: 'OBU GPS/GNSS. Alternatywa: bilet trasowy online przed podróżą (deklaracja trasy). e-Matrica dotyczy wyłącznie pojazdów <3,5t.',
    lastVerified: '2025-01-15',
    source: 'https://www.hu-go.hu/',
  },

  SI: {
    countryCode: 'SI',
    name: 'Slovenija',
    required: true,
    systemType: 'DSRC_OBU',
    systemName: 'DarsGo',
    appliesTo: 'Pojazdy >3,5t DMC na autostradach i drogach ekspresowych',
    obuDevice: 'DarsGo OBU (DSRC)',
    penalty: { amount: 800, currency: 'EUR', description: 'Kara 300-800 EUR za jazdę bez DarsGo' },
    purchase: {
      onlineUrl: 'https://www.dfrgo.si/',
      physicalLocations: ['Centra obsługi klienta DARS', 'Graniczne punkty DarsGo', 'Stacje paliw (Petrol, OMV)'],
    },
    acceptedPayment: ['Prepaid', 'Postpaid', 'Karta paliwowa'],
    acceptedFuelCards: ['DKV', 'UTA', 'E100'],
    notes: 'System mikrofalowy/DSRC. OBU wymagane na wszystkich autostradach DARS. Winieta (e-winieta) dotyczy wyłącznie pojazdów <3,5t.',
    lastVerified: '2025-01-15',
    source: 'https://www.dfrgo.si/',
  },

  BE: {
    countryCode: 'BE',
    name: 'België / Belgique',
    required: true,
    systemType: 'GPS_OBU',
    systemName: 'Viapass (Satellic)',
    appliesTo: 'Pojazdy >3,5t DMC na wszystkich drogach podlegających opłacie km',
    obuDevice: 'Satellic OBU (GPS)',
    penalty: { amount: 1000, currency: 'EUR', description: 'Kara 100-1 000 EUR; natychmiastowa płatność wymagana od pojazdów zagranicznych' },
    purchase: {
      onlineUrl: 'https://www.satellic.be/',
      physicalLocations: ['Punkty obsługi Satellic', 'Graniczne stacje obsługi', 'Stacje paliw (TotalEnergies, Q8)'],
    },
    acceptedPayment: ['Karta kredytowa', 'Karta paliwowa', 'Polecenie zapłaty'],
    acceptedFuelCards: ['DKV', 'UTA', 'AS24', 'Euroshell', 'E100', 'TotalEnergies Card'],
    notes: 'System GPS. OBU Satellic dostępne w punktach obsługi. Trzy regiony (Flandria, Walonia, Bruksela) zjednoczone w systemie Viapass.',
    lastVerified: '2025-01-15',
    source: 'https://www.viapass.be/',
  },

  NL: {
    countryCode: 'NL',
    name: 'Nederland',
    required: false,
    systemType: 'none',
    systemName: 'No HGV toll system',
    appliesTo: 'Nie dotyczy — brak opłat dystansowych dla ciężarówek',
    penalty: { amount: 0, currency: 'EUR', description: 'Nie dotyczy' },
    purchase: {
      physicalLocations: ['Nie dotyczy'],
    },
    acceptedPayment: [],
    acceptedFuelCards: [],
    notes: 'Brak systemu opłat km dla ciężarówek (stan na 2025). Planowana opłata Vrachtwagenheffing jeszcze nie obowiązuje. Kilka tuneli ma opłaty (Westerscheldetunnel, Kiltunnel) płatne na bramce.',
    lastVerified: '2025-01-15',
    source: 'https://www.rijkswaterstaat.nl/',
  },

  IT: {
    countryCode: 'IT',
    name: 'Italia',
    required: false,
    systemType: 'manual_toll',
    systemName: 'Autostrade (toll stations)',
    appliesTo: 'Wszystkie pojazdy na płatnych autostradach',
    obuDevice: 'Telepass OBU optional for non-stop passage',
    penalty: { amount: 500, currency: 'EUR', description: 'Kara za unikanie opłat; rejestracja pojazdu oznaczana' },
    purchase: {
      onlineUrl: 'https://www.telepass.com/',
      physicalLocations: ['Punkty Telepass', 'Stacje Autogrill', 'Pasy gotówkowe/kartowe na bramkach'],
    },
    acceptedPayment: ['Gotówka', 'Karta kredytowa', 'Telepass', 'VIACARD prepaid'],
    acceptedFuelCards: ['DKV', 'UTA', 'AS24', 'Euroshell'],
    interoperableWith: ['TIS-PL (FR)', 'VIA-T (ES)'],
    notes: 'OBU nie wymagane — płatność na bramkach. Urządzenie Telepass zalecane dla częstych użytkowników (pasy bezstopowe). Telepass EU działa we FR, ES, PT.',
    lastVerified: '2025-01-15',
    source: 'https://www.autostrade.it/',
  },

  CH: {
    countryCode: 'CH',
    name: 'Schweiz / Suisse',
    required: true,
    systemType: 'GPS_OBU',
    systemName: 'LSVA (Schwerverkehrsabgabe)',
    appliesTo: 'Wszystkie pojazdy >3,5t na wszystkich drogach w Szwajcarii',
    obuDevice: 'LSVA OBU (tripon device, mandatory)',
    penalty: { amount: 5000, currency: 'CHF', description: 'Kara do 5 000 CHF + zapłata zaległych opłat' },
    purchase: {
      onlineUrl: 'https://www.bazg.admin.ch/bazg/de/home/themen/lsva.html',
      physicalLocations: ['Urzędy celne na granicy', 'Regionalne biura BAZG'],
    },
    acceptedPayment: ['Polecenie zapłaty', 'Gwarancja bankowa', 'Karta paliwowa przez agenta'],
    acceptedFuelCards: ['DKV', 'UTA'],
    notes: 'Obowiązkowe OBU (tripon) dla wszystkich pojazdów ciężarowych. Musi być uzyskane przed wjazdem do CH. LSVA obowiązuje na WSZYSTKICH drogach (nie tylko autostradach). Osobna winieta dla pojazdów <3,5t.',
    lastVerified: '2025-01-15',
    source: 'https://www.bazg.admin.ch/',
  },

  ES: {
    countryCode: 'ES',
    name: 'España',
    required: false,
    systemType: 'manual_toll',
    systemName: 'Autopistas de peaje',
    appliesTo: 'Pojazdy na pozostałych płatnych autostradach (drogi AP)',
    obuDevice: 'VIA-T OBU optional for non-stop passage',
    penalty: { amount: 500, currency: 'EUR', description: 'Kara za unikanie opłat' },
    purchase: {
      onlineUrl: 'https://www.viat.es/',
      physicalLocations: ['Pasy gotówkowe na bramkach', 'Punkty obsługi VIA-T'],
    },
    acceptedPayment: ['Gotówka', 'Karta kredytowa', 'VIA-T'],
    acceptedFuelCards: ['DKV', 'UTA', 'Euroshell'],
    interoperableWith: ['TELEPASS (IT)', 'TIS-PL (FR)'],
    notes: 'Większość autostrad AP obecnie bezpłatna. Na pozostałych odcinkach płatnych bramki manualne/automatyczne. VIA-T do bezstopowego przejazdu.',
    lastVerified: '2025-01-15',
    source: 'https://www.autopistas.com/',
  },

  BG: {
    countryCode: 'BG',
    name: 'България',
    required: true,
    systemType: 'GPS_OBU',
    systemName: 'Toll system (API)',
    appliesTo: 'Pojazdy >3,5t DMC na drogach płatnych',
    obuDevice: 'Electronic toll OBU or route card',
    penalty: { amount: 3000, currency: 'BGN', description: 'Kara 1 800-3 000 BGN (~900-1 500 EUR)' },
    purchase: {
      onlineUrl: 'https://www.bgtoll.bg/',
      physicalLocations: ['Punkty obsługi BGToll', 'Przejścia graniczne', 'Stacje paliw'],
    },
    acceptedPayment: ['Prepaid', 'Bilet trasowy', 'Karta paliwowa'],
    acceptedFuelCards: ['DKV', 'UTA', 'E100'],
    notes: 'System GPS od 2020 r. zastąpił winiety dla pojazdów ciężarowych. Bilet trasowy (zadeklarowana trasa) dostępny jako alternatywa dla OBU.',
    lastVerified: '2025-01-15',
    source: 'https://www.bgtoll.bg/',
  },

  RO: {
    countryCode: 'RO',
    name: 'România',
    required: true,
    systemType: 'GPS_OBU',
    systemName: 'RO e-Toll (CNAIR)',
    appliesTo: 'Pojazdy >3,5t DMC na drogach krajowych i autostradach',
    obuDevice: 'RO e-Toll OBU or Rovinieta (vignette for some roads)',
    penalty: { amount: 2500, currency: 'RON', description: 'Kara ~500 EUR za brak opłaty/winiety' },
    purchase: {
      onlineUrl: 'https://www.erovinieta.ro/',
      physicalLocations: ['Graniczne punkty poboru opłat', 'Stacje paliw (OMV, Rompetrol, MOL)', 'Biura CNAIR'],
    },
    acceptedPayment: ['Gotówka', 'Karta kredytowa', 'Karta paliwowa'],
    acceptedFuelCards: ['DKV', 'UTA', 'E100', 'Rompetrol Card'],
    notes: 'System opłat dystansowych dla pojazdów ciężarowych. Rovinieta (winieta czasowa) nadal wymagana na niektórych drogach krajowych. Mogą być potrzebne oba dokumenty.',
    lastVerified: '2025-01-15',
    source: 'https://www.cfrr.ro/',
  },

  HR: {
    countryCode: 'HR',
    name: 'Hrvatska',
    required: false,
    systemType: 'manual_toll',
    systemName: 'HAC / ARZ (toll stations)',
    appliesTo: 'Wszystkie pojazdy na płatnych autostradach',
    obuDevice: 'ENC (Elektronička Naplata Cestarine) OBU optional',
    penalty: { amount: 750, currency: 'EUR', description: 'Kara za unikanie opłat' },
    purchase: {
      onlineUrl: 'https://www.hac.hr/',
      physicalLocations: ['Pasy gotówkowe na bramkach', 'Punkty obsługi HAC/ARZ', 'Punkty sprzedaży ENC na granicach'],
    },
    acceptedPayment: ['Gotówka (EUR)', 'Karta kredytowa', 'Urządzenie ENC'],
    acceptedFuelCards: ['DKV', 'UTA'],
    notes: 'System zamknięty — bilet przy wjeździe, opłata przy wyjeździe. Urządzenie ENC do pasów bezstopowych. Chorwacja przyjęła EUR w 2023.',
    lastVerified: '2025-01-15',
    source: 'https://www.hac.hr/',
  },

  DK: {
    countryCode: 'DK',
    name: 'Danmark',
    required: false,
    systemType: 'none',
    systemName: 'No distance-based toll',
    appliesTo: 'Nie dotyczy — brak opłat drogowych; tylko opłaty mostowe',
    penalty: { amount: 0, currency: 'DKK', description: 'Nie dotyczy (opłaty mostowe egzekwowane osobno)' },
    purchase: {
      physicalLocations: ['Bramki mostowe (Storebælt, Øresund)'],
    },
    acceptedPayment: ['Karta kredytowa', 'BroBizz'],
    acceptedFuelCards: ['DKV', 'UTA'],
    notes: 'Brak opłat drogowych dla ciężarówek. Tylko opłaty mostowe: Storebælt (740 DKK ciężarówka) i Øresund (900 DKK ciężarówka). OBU BroBizz daje zniżki na mostach.',
    lastVerified: '2025-01-15',
    source: 'https://www.storebaelt.dk/',
  },

  SE: {
    countryCode: 'SE',
    name: 'Sverige',
    required: false,
    systemType: 'none',
    systemName: 'No HGV distance toll',
    appliesTo: 'Nie dotyczy — tylko opłaty za wjazd do strefy w Sztokholmie/Göteborgu + opłaty mostowe',
    penalty: { amount: 0, currency: 'SEK', description: 'Opłaty za wjazd do strefy egzekwowane przez ANPR' },
    purchase: {
      physicalLocations: ['Automatycznie przez ANPR (opłaty za wjazd)', 'Øresund Bridge BroBizz'],
    },
    acceptedPayment: ['Automatycznie (rejestracja tablicy)', 'BroBizz'],
    acceptedFuelCards: [],
    notes: 'Brak opłat dystansowych. Opłata za wjazd w Sztokholmie (maks. 135 SEK/dzień) i Göteborgu (maks. 60 SEK/dzień) dla wszystkich pojazdów przez ANPR. Zwolnienia dla pojazdów Euro VI mogą obowiązywać.',
    lastVerified: '2025-01-15',
    source: 'https://www.transportstyrelsen.se/',
  },

  NO: {
    countryCode: 'NO',
    name: 'Norge',
    required: false,
    systemType: 'DSRC_OBU',
    systemName: 'AutoPASS',
    appliesTo: 'Wszystkie pojazdy przejeżdżające przez stacje poboru opłat (bompengeringer)',
    obuDevice: 'AutoPASS OBU (optional but gives discount)',
    penalty: { amount: 8000, currency: 'NOK', description: 'Faktura jeśli brak AutoPASS; wyższa stawka bez OBU' },
    purchase: {
      onlineUrl: 'https://www.autopass.no/',
      physicalLocations: ['Dostawcy usług AutoPASS', 'Rejestracja online dla pojazdów zagranicznych'],
    },
    acceptedPayment: ['AutoPASS OBU (prepaid/postpaid)', 'Faktura (ANPR, wyższa stawka)'],
    acceptedFuelCards: ['DKV', 'UTA'],
    interoperableWith: ['BroBizz (DK/SE)'],
    notes: 'Ponad 200 stacji poboru opłat w całym kraju. Bez AutoPASS: 20% dopłata + opłata za fakturę. Zmienne stawki w zależności od pory dnia. Wiele przepraw promowych również osobno płatnych. Łączny koszt opłat za pojedynczy przejazd przez Norwegię: 200-500 NOK.',
    lastVerified: '2025-01-15',
    source: 'https://www.autopass.no/',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Vignette / OBU requirement of one country (code in any letter case).
 */
export function getVignetteRequirement(countryCode: string): VignetteRequirement | undefined {
  return VIGNETTE_REQUIREMENTS[countryCode.toUpperCase()];
}

/**
 * All countries that require an OBU or vignette registration (`required: true`).
 */
export function getRequiredVignetteCountries(): string[] {
  return Object.entries(VIGNETTE_REQUIREMENTS)
    .filter(([, v]) => v.required)
    .map(([code]) => code);
}

/**
 * Which vignettes / OBUs are needed for the countries on a route
 * (only countries with an entry and `required: true`).
 */
export function getRouteVignetteRequirements(countryCodes: string[]): VignetteRequirement[] {
  return countryCodes
    .map((c) => VIGNETTE_REQUIREMENTS[c.toUpperCase()])
    .filter((v): v is VignetteRequirement => !!v && v.required);
}
