import { Injectable } from '@nestjs/common';

export type EmailCategory = 'OFFER' | 'INQUIRY' | 'COMPLAINT' | 'INVOICE' | 'OTHER';
export type EmailPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ClassificationResult {
  category: EmailCategory;
  priority: EmailPriority;
  tags: string[];
  extractedPickupCity?: string;
  extractedPickupCountry?: string;
  extractedDeliveryCity?: string;
  extractedDeliveryCountry?: string;
  extractedWeight?: number;
  extractedPrice?: number;
  /** Currency matched next to the price (EUR/€ → EUR, PLN/zł → PLN). */
  extractedCurrency?: 'EUR' | 'PLN';
  extractedDate?: Date;
  confidence: number; // 0-100
  reasoning: string;
}

// Keyword sets for category classification
const OFFER_KEYWORDS = [
  'zlecenie', 'transport', 'fracht', 'ładunek', 'trasa', 'przewóz', 'spedycja',
  'załadunek', 'rozładunek', 'nadawca', 'odbiorca', 'cmr', 'listy przewozowy',
  'oferta transportowa', 'freight', 'cargo', 'shipment', 'load', 'route',
  'pickup', 'delivery', 'sender', 'consignee', 'truck', 'vehicle',
];

const INQUIRY_KEYWORDS = [
  'zapytanie', 'pytanie', 'prośba', 'proszę', 'proszę o', 'czy możecie',
  'czy jesteście', 'availability', 'inquiry', 'request', 'please', 'could you',
  'informacja', 'szczegóły', 'warunki',
];

const COMPLAINT_KEYWORDS = [
  'reklamacja', 'skarga', 'problem', 'uszkodzenie', 'opóźnienie', 'brak',
  'niezgodność', 'complaint', 'damage', 'delay', 'missing', 'wrong',
  'niezadowolony', 'dissatisfied', 'żądanie', 'odszkodowanie',
];

const INVOICE_KEYWORDS = [
  'faktura', 'invoice', 'płatność', 'payment', 'rachunek', 'vat',
  'do zapłaty', 'należność', 'termin płatności', 'pro forma', 'rozliczenie',
  'przelew', 'zapłata', 'kwota do zapłaty',
];

const URGENT_KEYWORDS = [
  'pilne', 'pilny', 'urgent', 'asap', 'natychmiast', 'immediately',
  'dzisiaj', 'today', 'jutro', 'tomorrow', 'pilna dostawa', 'express',
  'priorytet', 'priority', 'jak najszybciej',
];

const LOW_PRIORITY_KEYWORDS = [
  'newsletter', 'informacja', 'aktualizacja', 'update', 'regulamin',
  'rodo', 'gdpr', 'unsubscribe', 'wypisz',
];

// Valid 2-letter ISO country codes — used to validate captures
const VALID_COUNTRY_CODES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR',
  'HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
  'UA','BY','RU','GB','NO','CH','TR','US','CA','CN',
]);

// Country name → ISO mapping
const COUNTRY_MAP: Record<string, string> = {
  'polska': 'PL', 'poland': 'PL',
  'niemcy': 'DE', 'germany': 'DE', 'deutschland': 'DE',
  'francja': 'FR', 'france': 'FR',
  'czechy': 'CZ', 'czech': 'CZ',
  'austria': 'AT',
  'słowacja': 'SK', 'slovakia': 'SK',
  'węgry': 'HU', 'hungary': 'HU',
  'włochy': 'IT', 'italy': 'IT', 'italia': 'IT',
  'hiszpania': 'ES', 'spain': 'ES',
  'holandia': 'NL', 'netherlands': 'NL', 'holland': 'NL',
  'belgia': 'BE', 'belgium': 'BE',
  'dania': 'DK', 'denmark': 'DK',
  'szwecja': 'SE', 'sweden': 'SE',
  'rumunia': 'RO', 'romania': 'RO',
  'bułgaria': 'BG', 'bulgaria': 'BG',
  'litwa': 'LT', 'lithuania': 'LT',
  'łotwa': 'LV', 'latvia': 'LV',
  'estonia': 'EE',
  'ukraina': 'UA', 'ukraine': 'UA',
};

// ── Number parsing ────────────────────────────────────────────────────────────
//
// Handles: "18 000", "18.000", "18000", "2 850", "2850", "24,5", "1.200,50"
//
function parseNum(raw: string): number {
  const s = raw.trim().replace(/\s+/g, ''); // remove all whitespace

  // "18.000" or "2.850.000" — dot as thousands separator (followed by exactly 3 digits)
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    return parseFloat(s.replace(/\./g, ''));
  }

  // Decimal comma: "24,5" or "1.200,50" — comma with 1–2 decimal digits at end
  if (/,\d{1,2}$/.test(s)) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  }

  // Plain number or dot-decimal ("24.5")
  return parseFloat(s.replace(',', '.'));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

/**
 * Country names as they appear after a preposition ("z Polski", "do Niemiec")
 * — recognized as a country, never as a city.
 */
const COUNTRY_AFTER_PREPOSITION: Record<string, string> = {
  polski: 'PL', niemiec: 'DE', francji: 'FR', czech: 'CZ', austrii: 'AT',
  słowacji: 'SK', węgier: 'HU', włoch: 'IT', hiszpanii: 'ES', holandii: 'NL',
  belgii: 'BE', danii: 'DK', szwecji: 'SE', rumunii: 'RO', bułgarii: 'BG',
  litwy: 'LT', łotwy: 'LV', estonii: 'EE', ukrainy: 'UA',
};

/** A word or phrase that is a country: a name (any form) or an ISO code. */
function countryOf(token: string): string | undefined {
  const t = token.trim().toLowerCase();
  return COUNTRY_MAP[t] ?? COUNTRY_AFTER_PREPOSITION[t] ?? (/^[a-z]{2}$/.test(t) ? toCountryCode(t) : undefined);
}

/**
 * The place in the text after a "załadunek/rozładunek …" label.
 *
 * The text is split at commas. The country comes from "(PL)", a separate
 * part "PL", a postal-code prefix "PL-60-001" or a name ("Polska", "Niemcy").
 * Postal codes are removed. The city is the first part with letters that is
 * not a country — a country never becomes the city. Handles, among others:
 *   "Poznań, PL", "Poznań 60-001 (PL)", "Polska, Poznań", "Poznań, Polska",
 *   "PL-60-001 Poznań", "60-001 Poznań (PL)", "Polska" (a country, no city).
 */
function parsePlace(segment: string): { city?: string; country?: string } {
  let country: string | undefined;
  let city: string | undefined;
  for (const raw of segment.split(',')) {
    let part = raw;
    // (PL), (Niemcy)
    part = part.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
      country ??= countryOf(inner);
      return ' ';
    });
    // PL-60-001, DE-10115 — a country prefix on the postal code
    part = part.replace(/\b([A-Za-z]{2})-(?=\d)/g, (m, cc: string) => {
      const code = toCountryCode(cc);
      if (!code) return m;
      country ??= code;
      return '';
    });
    // postal codes: 60-001, 10115, 1012 AB (NL)
    part = part.replace(/\b\d{2}-\d{3}\b|\b\d{4}\s?[A-Z]{2}\b|\b\d{4,5}\b/g, ' ');
    part = part.replace(/\s+/g, ' ').trim().replace(/^[\s.:;–-]+|[\s.:;–-]+$/g, '');
    if (!/\p{L}/u.test(part)) continue;
    const asCountry = countryOf(part);
    if (asCountry) {
      country ??= asCountry;
      continue;
    }
    city ??= part;
  }
  return { city, country };
}

// Extract a valid 2-letter country code (uppercase) from a regex match group
function toCountryCode(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const code = raw.toUpperCase();
  return VALID_COUNTRY_CODES.has(code) ? code : undefined;
}

// ── Regex building blocks ─────────────────────────────────────────────────────
//
// Number with optional thousands-space or dot grouping.
// Matches: "18 000", "18.000", "18000", "2 850", "1 200 000", "24,5", "1200"
// Does NOT span across newlines (only a single literal space is allowed as thousands sep).
//
// (?<![\d.,])                — start at the beginning of a number, never inside one
// \d{1,3}(?:[. ]\d{3})+      — grouped thousands ("2 850", "18.000")
// | \d+                      — or plain digits ("1200", "24000")
// (?:[,.]\d{1,2})?           — optional decimal part (comma or dot + 1–2 digits)
//
// The lookbehind is required: without it a match could start in the middle of a
// number — "1200 €" read as 200, "3500 zł" as 500 — and "24000 kg" gave no weight.
//
const NUM = '(?<![\\d.,])((?:\\d{1,3}(?:[. ]\\d{3})+|\\d+)(?:[,.]\\d{1,2})?)';

// Currency: EUR, €, PLN, zł — must NOT be followed by a letter (avoids "europalety")
const CURR = '(EUR|€|PLN|zł)(?![A-Za-z])';

/** Currency as written in the text → code. */
const CURRENCY_CODE: Record<string, 'EUR' | 'PLN'> = { eur: 'EUR', '€': 'EUR', pln: 'PLN', 'zł': 'PLN' };

@Injectable()
export class EmailClassifierService {
  // `_fromEmail`: part of the contract (the LLM uses it); the rules ignore the sender.
  classify(subject: string, body: string, _fromEmail: string): ClassificationResult {
    const fullText = `${subject} ${body}`;

    // ── Category scoring ─────────────────────────────────────────────────────

    const offerScore     = scoreKeywords(fullText, OFFER_KEYWORDS);
    const inquiryScore   = scoreKeywords(fullText, INQUIRY_KEYWORDS);
    const complaintScore = scoreKeywords(fullText, COMPLAINT_KEYWORDS);
    const invoiceScore   = scoreKeywords(fullText, INVOICE_KEYWORDS);

    let category: EmailCategory = 'OTHER';
    let maxScore = 0;
    const reasonParts: string[] = [];

    if (offerScore     > maxScore) { maxScore = offerScore;     category = 'OFFER';     }
    if (inquiryScore   > maxScore) { maxScore = inquiryScore;   category = 'INQUIRY';   }
    if (complaintScore > maxScore) { maxScore = complaintScore; category = 'COMPLAINT'; }
    if (invoiceScore   > maxScore) { maxScore = invoiceScore;   category = 'INVOICE';   }

    reasonParts.push(`Kategoria: ${category} (score=${maxScore})`);

    // Subject-line boosts
    const subjectLower = subject.toLowerCase();
    if (subjectLower.includes('faktura') || subjectLower.includes('invoice')) {
      category = 'INVOICE';
      reasonParts.push('Faktura w temacie');
    }
    if (subjectLower.includes('reklamacja') || subjectLower.includes('complaint')) {
      category = 'COMPLAINT';
      reasonParts.push('Reklamacja w temacie');
    }

    // ── Priority ─────────────────────────────────────────────────────────────

    const urgentScore = scoreKeywords(fullText, URGENT_KEYWORDS);
    const lowScore    = scoreKeywords(fullText, LOW_PRIORITY_KEYWORDS);
    let priority: EmailPriority = 'MEDIUM';
    if (urgentScore >= 1) {
      priority = 'HIGH';
      reasonParts.push(`Pilny (${urgentScore} słów kluczowych)`);
    } else if (lowScore >= 2 || maxScore === 0) {
      priority = 'LOW';
    }

    // ── Tags ─────────────────────────────────────────────────────────────────

    const tags: string[] = [];
    if (/\badr\b/i.test(fullText))                        tags.push('ADR');
    if (/chłodnia|frigo|refriger/i.test(fullText))        tags.push('FRIGO');
    if (/ton[ny]?|kg|ładun/i.test(fullText))              tags.push('CIĘŻKI');
    if (/express|pilne|urgent/i.test(fullText))           tags.push('EKSPRES');
    if (/kabotaż|cabotage/i.test(fullText))               tags.push('KABOTAŻ');
    if (/wymiana palet|pallet exchange/i.test(fullText))  tags.push('PALETY');

    // ── Data extraction ───────────────────────────────────────────────────────

    let extractedPickupCity: string | undefined;
    let extractedPickupCountry: string | undefined;
    let extractedDeliveryCity: string | undefined;
    let extractedDeliveryCountry: string | undefined;
    let extractedWeight: number | undefined;
    let extractedPrice: number | undefined;
    let extractedCurrency: 'EUR' | 'PLN' | undefined;
    let extractedDate: Date | undefined;

    // ── 1. WEIGHT ─────────────────────────────────────────────────────────────
    //
    // Patterns: "18 000 kg", "18.000 kg", "18000 kg", "24 t", "24,5 t", "18 ton"
    // \b before number ensures we don't start in the middle of another number.
    // Unit must NOT be followed by a word char (avoids false matches inside words).
    //
    const weightRe = new RegExp(`\\b${NUM}\\s*(t\\b|tony?|ton(?:ę|ą)?|kg)(?![A-Za-z])`, 'i');
    const weightMatch = fullText.match(weightRe);
    if (weightMatch) {
      const raw = parseNum(weightMatch[1]);
      const unit = weightMatch[2].toLowerCase();
      if (!isNaN(raw) && raw > 0) {
        extractedWeight = unit.startsWith('kg') ? raw : raw * 1000;
        reasonParts.push(`Waga: ${extractedWeight} kg`);
      }
    }

    // ── 2. PRICE ──────────────────────────────────────────────────────────────
    //
    // Priority: labeled ("Fracht: 2 850 EUR") > generic ("2 850 EUR")
    // Currency MUST NOT be followed by a letter (blocks "europalety").
    //
    const priceLabeledRe = new RegExp(
      `(?:fracht|stawka|cena|kwota|wartość|rate|freight)[:\\s]+${NUM}\\s*${CURR}`,
      'i',
    );
    const priceGenericRe = new RegExp(`${NUM}\\s*${CURR}`, 'i');

    const priceM = fullText.match(priceLabeledRe) ?? fullText.match(priceGenericRe);
    if (priceM) {
      const raw = parseNum(priceM[1]);
      if (!isNaN(raw) && raw > 0) {
        extractedPrice = raw;
        // The currency next to the price is kept (createOfferFromEmail uses it when the LLM gave none).
        extractedCurrency = CURRENCY_CODE[priceM[2].toLowerCase()];
        reasonParts.push(`Cena: ${extractedPrice}`);
      }
    }

    // ── 3. DATE ───────────────────────────────────────────────────────────────

    const dateMatch = fullText.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}[./]\d{2}[./]\d{4})\b/);
    if (dateMatch) {
      const raw = dateMatch[1];
      if (raw.includes('-')) {
        extractedDate = new Date(raw);
      } else {
        const sep = raw.includes('.') ? '.' : '/';
        const parts = raw.split(sep);
        extractedDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      }
      if (isNaN(extractedDate?.getTime())) extractedDate = undefined;
      else reasonParts.push(`Data: ${extractedDate.toISOString().slice(0, 10)}`);
    }

    // ── 4. CITIES & COUNTRIES ─────────────────────────────────────────────────
    //
    // Strategy (ordered by reliability):
    //   A) Labeled patterns: "Załadunek: CITY, PL" / "Rozładunek: CITY, NL"
    //   B) Arrow/dash between country codes: "PL → NL" (countries only, no cities)
    //   C) Polish prepositions: "\bz\b CITY ... \bdo\b CITY"
    //   D) English: "from CITY ... to CITY"
    //

    // The label and its text, up to the end of the line, a semicolon or the next label.
    const PICKUP_WORDS = 'załadunek|loading|pickup|odbiór';
    const DELIVERY_WORDS = 'rozładunek|unloading|delivery|dostawa|wydanie';
    const segmentAfter = (labels: string) =>
      // `(?<![\\p{L}])`: "loading" must not start inside "Unloading".
      fullText.match(new RegExp(`(?<![\\p{L}])(?:${labels})[:\\s]+(.+?)(?=[;\\n\\r]|(?<![\\p{L}])(?:${PICKUP_WORDS}|${DELIVERY_WORDS})(?![\\p{L}])|$)`, 'iu'))?.[1];

    const pickupSegment = segmentAfter(PICKUP_WORDS);
    const deliverySegment = segmentAfter(DELIVERY_WORDS);
    const labeled = Boolean(pickupSegment || deliverySegment);
    if (pickupSegment) {
      const place = parsePlace(pickupSegment);
      extractedPickupCity = place.city;
      extractedPickupCountry = place.country;
      if (place.city) reasonParts.push(`Załadunek: ${place.city}`);
    }
    if (deliverySegment) {
      const place = parsePlace(deliverySegment);
      extractedDeliveryCity = place.city;
      extractedDeliveryCountry = place.country;
      if (place.city) reasonParts.push(`Rozładunek: ${place.city}`);
    }

    // B) Arrow notation: "PL → NL" (country codes only)
    const arrowM = fullText.match(/\b([A-Z]{2})\s*[→\-–>]+\s*([A-Z]{2})\b/);
    if (arrowM) {
      if (!extractedPickupCountry)   extractedPickupCountry   = toCountryCode(arrowM[1]);
      if (!extractedDeliveryCountry) extractedDeliveryCountry = toCountryCode(arrowM[2]);
    }

    // Without labels: the first country name in the text → the pickup country
    // (the delivery country is not guessed). With labels nothing is guessed —
    // otherwise "rozładunek Niemcy, Berlin" would put the pickup in DE.
    if (!labeled && !extractedPickupCountry) {
      const names = Object.keys(COUNTRY_MAP).join('|');
      const first = fullText.match(new RegExp(`(?<![\\p{L}])(${names})(?![\\p{L}])`, 'iu'));
      if (first) extractedPickupCountry = COUNTRY_MAP[first[1].toLowerCase()];
    }

    // C) Polish prepositions — ONLY if labeled patterns didn't fire
    //    Use \b word boundary so "z" doesn't match inside words like "Poznań"
    // A country after a preposition ("z Polski", "do Niemiec") gives the country, not a city.
    if (!extractedPickupCity) {
      const fromPL = fullText.match(/\bz\s+([A-ZŁŚŻŹÓĄĘĆ][A-Za-ząęółśżźćńóĄĘŁŚŻŹÓĆŃ-]+)/);
      const country = fromPL && countryOf(fromPL[1]);
      if (country) extractedPickupCountry ??= country;
      else if (fromPL) extractedPickupCity = fromPL[1];
    }
    if (!extractedDeliveryCity) {
      const toPL = fullText.match(/\bdo\s+([A-ZŁŚŻŹÓĄĘĆ][A-Za-ząęółśżźćńóĄĘŁŚŻŹÓĆŃ-]+)/);
      const country = toPL && countryOf(toPL[1]);
      if (country) extractedDeliveryCountry ??= country;
      else if (toPL) extractedDeliveryCity = toPL[1];
    }

    // D) English prepositions — fallback
    if (!extractedPickupCity) {
      const fromEN = fullText.match(/\bfrom\s+([A-Z][A-Za-z-]+)/);
      const country = fromEN && countryOf(fromEN[1]);
      if (country) extractedPickupCountry ??= country;
      else if (fromEN) extractedPickupCity = fromEN[1];
    }
    if (!extractedDeliveryCity) {
      const toEN = fullText.match(/\bto\s+([A-Z][A-Za-z-]+)/);
      const country = toEN && countryOf(toEN[1]);
      if (country) extractedDeliveryCountry ??= country;
      else if (toEN) extractedDeliveryCity = toEN[1];
    }

    // ── Confidence ────────────────────────────────────────────────────────────

    let confidence = 40;
    if (maxScore >= 3)          confidence += 25;
    else if (maxScore >= 1)     confidence += 10;
    if (extractedPickupCity)    confidence += 10;
    if (extractedDeliveryCity)  confidence += 10;
    if (extractedWeight)        confidence += 5;
    if (extractedPrice)         confidence += 5;
    if (extractedDate)          confidence += 5;
    confidence = Math.min(confidence, 95);

    return {
      category,
      priority,
      tags,
      extractedPickupCity,
      extractedPickupCountry,
      extractedDeliveryCity,
      extractedDeliveryCountry,
      extractedWeight,
      extractedPrice,
      extractedCurrency,
      extractedDate,
      confidence,
      reasoning: reasonParts.join('; ') || 'Brak wyraźnych słów kluczowych',
    };
  }
}
