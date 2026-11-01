import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClassificationResult } from './email-classifier.service';

// ── Extended types ────────────────────────────────────────────────────────────

export interface LlmExtractedData {
  pickupCity?: string | null;
  pickupCountry?: string | null;
  pickupPostal?: string | null;
  deliveryCity?: string | null;
  deliveryCountry?: string | null;
  deliveryPostal?: string | null;
  pickupDate?: string | null;
  deliveryDate?: string | null;
  weight?: number | null;
  price?: number | null;
  currency?: string | null;
  vehicleType?: string | null;
  palletCount?: number | null;
  palletExchange?: boolean;
  isAdr?: boolean;
  adrClass?: string | null;
  temperatureMin?: number | null;
  temperatureMax?: number | null;
  paymentTermDays?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  companyName?: string | null;
  nip?: string | null;
}

export interface LlmClassificationResult extends ClassificationResult {
  method: 'llm';
  llmCategory: string;
  summary: string;
  extractedData: LlmExtractedData;
  inputTokens: number;
  outputTokens: number;
}

// ── Category / priority mapping to DB enums ───────────────────────────────────

type DbCategory = 'OFFER' | 'INQUIRY' | 'COMPLAINT' | 'INVOICE' | 'OTHER';
type DbPriority = 'HIGH' | 'MEDIUM' | 'LOW';

const CATEGORY_MAP: Record<string, DbCategory> = {
  OFFER:              'OFFER',
  ORDER_CONFIRMATION: 'OFFER',
  CONTRACTOR:         'INQUIRY',
  INQUIRY:            'INQUIRY',
  INVOICE:            'INVOICE',
  COMPLAINT:          'COMPLAINT',
  ADVERTISEMENT:      'OTHER',
  AUTHORITY:          'OTHER',
  INTERNAL:           'OTHER',
  OTHER:              'OTHER',
};

const PRIORITY_MAP: Record<string, DbPriority> = {
  HIGH:   'HIGH',
  NORMAL: 'MEDIUM',
  MEDIUM: 'MEDIUM',
  LOW:    'LOW',
};

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class LlmClassifierService {
  private readonly logger = new Logger(LlmClassifierService.name);
  private readonly apiKey: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (this.apiKey) {
      this.logger.log('Anthropic API key found — LLM classification enabled');
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — falling back to regex classifier');
    }
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  async classifyWithLLM(
    subject: string,
    body: string,
    fromEmail: string,
  ): Promise<LlmClassificationResult> {
    // Dynamic import so the app still starts if SDK is somehow absent
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: this.apiKey });

    const systemPrompt =
      'Jesteś asystentem spedycji transportowej. Analizujesz emaile i wyciągasz z nich dane. ' +
      'Odpowiedz TYLKO w formacie JSON, bez żadnego dodatkowego tekstu.';

    const userPrompt =
      `Przeanalizuj poniższy email i zwróć JSON z polami:\n` +
      `{\n` +
      `  "category": "OFFER" | "CONTRACTOR" | "ORDER_CONFIRMATION" | "INVOICE" | "COMPLAINT" | "ADVERTISEMENT" | "AUTHORITY" | "INTERNAL" | "OTHER",\n` +
      `  "priority": "HIGH" | "NORMAL" | "LOW",\n` +
      `  "tags": ["lista tagów np. ADR, FRIGO, PILNE, PALETY, CMR"],\n` +
      `  "confidence": 0.0-1.0,\n` +
      `  "extractedData": {\n` +
      `    "pickupCity": "miasto załadunku lub null",\n` +
      `    "pickupCountry": "kod kraju 2-literowy lub null",\n` +
      `    "pickupPostal": "kod pocztowy lub null",\n` +
      `    "deliveryCity": "miasto rozładunku lub null",\n` +
      `    "deliveryCountry": "kod kraju lub null",\n` +
      `    "deliveryPostal": "kod pocztowy lub null",\n` +
      `    "pickupDate": "YYYY-MM-DD lub null",\n` +
      `    "deliveryDate": "YYYY-MM-DD lub null",\n` +
      `    "weight": liczba w kg lub null,\n` +
      `    "price": liczba lub null,\n` +
      `    "currency": "EUR" | "PLN" lub null,\n` +
      `    "vehicleType": "plandeka" | "frigo" | "chłodnia" | "kontener" | "wywrotka" | null,\n` +
      `    "palletCount": liczba lub null,\n` +
      `    "palletExchange": true/false,\n` +
      `    "isAdr": true/false,\n` +
      `    "adrClass": "klasa ADR lub null",\n` +
      `    "temperatureMin": liczba lub null,\n` +
      `    "temperatureMax": liczba lub null,\n` +
      `    "paymentTermDays": liczba lub null,\n` +
      `    "contactName": "imię i nazwisko nadawcy lub null",\n` +
      `    "contactPhone": "telefon lub null",\n` +
      `    "contactEmail": "email kontaktowy lub null",\n` +
      `    "companyName": "nazwa firmy nadawcy lub null",\n` +
      `    "nip": "NIP lub null"\n` +
      `  },\n` +
      `  "summary": "krótkie podsumowanie emaila po polsku (1-2 zdania)"\n` +
      `}\n\n` +
      `Temat: ${subject}\n` +
      `Od: ${fromEmail}\n` +
      `Treść:\n` +
      body.slice(0, 3000);

    const response = await client.messages.create(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { timeout: 10_000 },
    );

    const rawText: string =
      Array.isArray(response.content) && response.content[0]?.type === 'text'
        ? response.content[0].text
        : '{}';

    const inputTokens: number = response.usage?.input_tokens ?? 0;
    const outputTokens: number = response.usage?.output_tokens ?? 0;

    this.logger.log(
      `LLM tokens: ${inputTokens} in / ${outputTokens} out (claude-haiku-4-5-20251001)`,
    );

    // Strip possible markdown code fences from response
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    const llmCategory: string = (parsed.category ?? 'OTHER').toUpperCase();
    const llmPriority: string = (parsed.priority ?? 'NORMAL').toUpperCase();
    const ed: LlmExtractedData = parsed.extractedData ?? {};

    const category: DbCategory = CATEGORY_MAP[llmCategory] ?? 'OTHER';
    const priority: DbPriority = PRIORITY_MAP[llmPriority] ?? 'MEDIUM';

    let extractedDate: Date | undefined;
    if (ed.pickupDate) {
      const d = new Date(ed.pickupDate);
      if (!isNaN(d.getTime())) extractedDate = d;
    }

    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.round(parsed.confidence * 100)
        : 80;

    const summary: string = parsed.summary ?? '';

    return {
      method: 'llm',
      llmCategory,
      category,
      priority,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      confidence,
      reasoning: summary,
      summary,
      extractedPickupCity:      ed.pickupCity    ?? undefined,
      extractedPickupCountry:   ed.pickupCountry ?? undefined,
      extractedDeliveryCity:    ed.deliveryCity  ?? undefined,
      extractedDeliveryCountry: ed.deliveryCountry ?? undefined,
      extractedWeight: typeof ed.weight === 'number' ? ed.weight : undefined,
      extractedPrice:  typeof ed.price  === 'number' ? ed.price  : undefined,
      extractedDate,
      extractedData: ed,
      inputTokens,
      outputTokens,
    };
  }
}
