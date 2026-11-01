import { Prisma, type EmailCategory, type EmailPriority } from '@prisma/client';
import type { LlmExtractedData } from './llm-classifier.service';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { msg } from '../common/plan-messages';
import { companyCurrency } from '../common/money';
import { fitsMoneyColumn } from '../common/db-limits';
import { PrismaService } from '../prisma/prisma.service';
import { ClassificationResult, EmailClassifierService } from './email-classifier.service';
import { LlmClassificationResult, LlmClassifierService } from './llm-classifier.service';
import { buildPaginatedResponse } from '../common/dto/pagination.dto';
import { TaskQueueService } from '../common/queue/task-queue.service';
import { OffersService } from '../offers/offers.service';
import { economicsFor } from '../offers/offer-economics';
import type { ProcessEmailDto, SimulateEmailDto } from './dto/process-email.dto';
import type { UpdateEmailDto } from './dto/update-email.dto';
import type { InboxQueryDto } from './dto/inbox-query.dto';

// ── DTOs ──────────────────────────────────────────────────────────────────────

// ── Unified classification result returned by this service ────────────────────

export interface UnifiedClassification {
  method: 'llm' | 'regex';
  category: EmailCategory;
  priority: EmailPriority;
  tags: string[];
  confidence: number;
  reasoning?: string;
  summary?: string;
  llmCategory?: string;
  inputTokens?: number;
  outputTokens?: number;
  extractedPickupCity?: string;
  extractedPickupCountry?: string;
  extractedDeliveryCity?: string;
  extractedDeliveryCountry?: string;
  extractedWeight?: number;
  extractedPrice?: number;
  extractedDate?: Date;
  extractedData?: LlmExtractedData; // LLM-only extended fields
}

// ── Service ───────────────────────────────────────────────────────────────────

/** 409 EMAIL_OFFER_EXISTS — the screen shows a link to the existing offer. */
function offerExists(offerId: string | null) {
  const m = msg('EMAIL_OFFER_EXISTS', { offerId: offerId ?? '' });
  return new ConflictException({ statusCode: 409, ...m, message: m.code });
}

/** The e-mail fields the price currency needs. */
type PriceEmail = {
  id: string; subject: string; body: string; fromEmail: string;
  extractedPrice: number | null; createdOfferId: string | null; llmExtractedData: Prisma.JsonValue | null;
};

@Injectable()
export class EmailAgentService {
  private readonly logger = new Logger(EmailAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly regexClassifier: EmailClassifierService,
    private readonly llmClassifier: LlmClassifierService,
    private readonly taskQueue: TaskQueueService,
    private readonly offers: OffersService,
  ) {}

  // ── Classify (LLM with regex fallback) ───────────────────────────────────

  private async classify(
    subject: string,
    body: string,
    fromEmail: string,
  ): Promise<UnifiedClassification> {
    if (this.llmClassifier.isAvailable) {
      try {
        const r: LlmClassificationResult = await this.llmClassifier.classifyWithLLM(
          subject, body, fromEmail,
        );
        return { ...r, method: 'llm' };
      } catch (err) {
        this.logger.warn(`LLM classify failed (${err instanceof Error ? err.message : String(err)}), falling back to regex`);
      }
    }

    const r: ClassificationResult = this.regexClassifier.classify(subject, body, fromEmail);
    return { ...r, method: 'regex' };
  }

  // ── Process & save email ─────────────────────────────────────────────────

  async processEmail(dto: ProcessEmailDto, companyId: string) {
    const classification = await this.taskQueue.enqueue(
      () => this.classify(dto.subject, dto.body, dto.fromEmail),
    );
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();

    const email = await this.prisma.emailMessage.create({
      data: {
        companyId,
        messageId: dto.messageId,
        subject: dto.subject,
        fromName: dto.fromName,
        fromEmail: dto.fromEmail,
        toEmail: dto.toEmail,
        body: dto.body,
        receivedAt,
        category: classification.category,
        priority: classification.priority,
        tags: classification.tags,
        extractedPickupCity:      classification.extractedPickupCity,
        extractedPickupCountry:   classification.extractedPickupCountry,
        extractedDeliveryCity:    classification.extractedDeliveryCity,
        extractedDeliveryCountry: classification.extractedDeliveryCountry,
        extractedWeight:          classification.extractedWeight,
        extractedPrice:           classification.extractedPrice,
        extractedDate:            classification.extractedDate,
        llmSummary:               classification.summary ?? null,
        llmCategory:              classification.llmCategory ?? null,
        // Full LLM JSON — used later by createOfferFromEmail for rich field mapping
        // It comes from JSON.parse of the model's answer — always valid JSON.
        llmExtractedData: classification.extractedData ? (classification.extractedData as Prisma.InputJsonObject) : Prisma.DbNull,
      },
    });

    return { email, classification };
  }

  // ── Simulate classification (no save) ───────────────────────────────────

  async simulateClassification(dto: SimulateEmailDto): Promise<{ classification: UnifiedClassification }> {
    const classification = await this.classify(dto.subject, dto.body, dto.fromEmail);
    return { classification };
  }

  // ── Inbox ────────────────────────────────────────────────────────────────

  async getInbox(companyId: string, filters: InboxQueryDto) {
    const where: Prisma.EmailMessageWhereInput = { companyId };

    if (filters.category && filters.category !== 'ALL') {
      where['category'] = filters.category as EmailCategory; // the DTO allows only enum values or ALL
    }
    if (filters.unreadOnly === 'true') {
      where['isRead'] = false;
    }
    if (filters.starred === 'true') {
      where['isStarred'] = true;
    }
    if (filters.search) {
      const q = filters.search;
      where['OR'] = [
        { subject:   { contains: q, mode: 'insensitive' } },
        { fromEmail: { contains: q, mode: 'insensitive' } },
        { fromName:  { contains: q, mode: 'insensitive' } },
        { body:      { contains: q, mode: 'insensitive' } },
      ];
    }

    const limit  = Math.min(parseInt(filters.limit  ?? '20', 10), 100);
    // `page` as in the other lists; `offset` is the old name of the page
    // number — with both at once, `page` wins (README, "Inbox").
    const page = Math.max(parseInt(filters.page ?? filters.offset ?? '1', 10), 1);

    const [data, total] = await Promise.all([
      this.prisma.emailMessage.findMany({
        where,
        orderBy: [{ isRead: 'asc' }, { receivedAt: 'desc' }],
        take: limit,
        skip: (page - 1) * limit,
        select: {
          id: true,
          subject: true,
          fromName: true,
          fromEmail: true,
          receivedAt: true,
          category: true,
          priority: true,
          isRead: true,
          isStarred: true,
          tags: true,
          extractedPickupCity: true,
          extractedDeliveryCity: true,
          extractedPrice: true,
          createdOfferId: true,
          llmCategory: true,
          // Only for the price currency (below) — not sent in the response.
          body: true,
          llmExtractedData: true,
        },
      }),
      this.prisma.emailMessage.count({ where }),
    ]);

    const currencies = await this.priceCurrencies(companyId, data);
    const items = data.map(({ body: _body, llmExtractedData: _llm, ...e }) => ({ ...e, extractedCurrency: currencies.get(e.id) ?? null }));
    return buildPaginatedResponse(items, total, page, limit);
  }

  // ── Price currency (README, "Price currency") ───────────────────────────
  // Computed when read, no column. An e-mail an offer was created from → that
  // offer's currency (the truth). No offer (or the offer deleted) → the model's
  // currency, otherwise the one the regex found next to THE SAME price in the
  // text; none → null (the screen then writes no "EUR"). The same rule picks
  // the currency of an offer created from an e-mail.

  private llmCurrency(email: { llmExtractedData: Prisma.JsonValue | null }): string | null {
    const raw = email.llmExtractedData;
    const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>)['currency'] : null;
    return typeof c === 'string' && c ? c : null;
  }

  private textCurrency(email: PriceEmail): string | null {
    if (email.extractedPrice === null) return null;
    const r = this.regexClassifier.classify(email.subject, email.body, email.fromEmail);
    return r.extractedPrice === email.extractedPrice ? r.extractedCurrency ?? null : null;
  }

  private async priceCurrencies(companyId: string, emails: PriceEmail[]): Promise<Map<string, string | null>> {
    const offerIds = [...new Set(emails.map((e) => e.createdOfferId).filter((id): id is string => !!id))];
    const offers = offerIds.length
      ? await this.prisma.offer.findMany({ where: { id: { in: offerIds }, companyId }, select: { id: true, currency: true } })
      : [];
    const offerCurrency = new Map(offers.map((o) => [o.id, o.currency]));
    return new Map(emails.map((e) => [
      e.id,
      (e.createdOfferId ? offerCurrency.get(e.createdOfferId) : undefined) ?? this.llmCurrency(e) ?? this.textCurrency(e),
    ]));
  }

  // ── Email detail ─────────────────────────────────────────────────────────

  async getEmail(emailId: string, companyId: string) {
    const email = await this.prisma.emailMessage.findFirst({
      where: { id: emailId, companyId },
    });
    if (!email) throw new NotFoundException('Email nie znaleziony');
    const currencies = await this.priceCurrencies(companyId, [email]);
    return { ...email, extractedCurrency: currencies.get(email.id) ?? null };
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  async getStats(companyId: string) {
    const emails = await this.prisma.emailMessage.findMany({
      where: { companyId },
      select: { category: true, isRead: true, priority: true, createdOfferId: true },
    });

    const total   = emails.length;
    const unread  = emails.filter((e) => !e.isRead).length;
    const offersToReview = emails.filter(
      (e) => e.category === 'OFFER' && !e.createdOfferId,
    ).length;

    const byCategory: Record<string, number> = {};
    for (const e of emails) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    }

    const byPriority: Record<string, number> = {};
    for (const e of emails) {
      byPriority[e.priority] = (byPriority[e.priority] ?? 0) + 1;
    }

    return { total, unread, offersToReview, byCategory, byPriority };
  }

  // ── Create offer from email ───────────────────────────────────────────────

  async createOfferFromEmail(emailId: string, companyId: string) {
    const email = await this.prisma.emailMessage.findFirst({
      where: { id: emailId, companyId },
    });
    if (!email) throw new NotFoundException('Email nie znaleziony');

    // A second click or a second tab: an offer from this e-mail already exists → 409 with its id.
    // `createdOfferId` has no foreign key — a deleted offer leaves a dead link,
    // and then a new offer may be created.
    if (email.createdOfferId) {
      const existing = await this.prisma.offer.findFirst({
        where: { id: email.createdOfferId, companyId },
        select: { id: true },
      });
      if (existing) throw offerExists(existing.id);
    }

    // ── Map rich LLM fields from stored JSON ─────────────────────────────
    // JSON from the model's answer — each field read only in its own type:
    // text that is not text, or a number that is not a number, is missing.
    const raw = email.llmExtractedData;
    const llm: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const str = (key: string): string | null => (typeof llm[key] === 'string' && llm[key] ? (llm[key] as string) : null);
    const num = (key: string): number | null => (typeof llm[key] === 'number' && Number.isFinite(llm[key]) ? (llm[key] as number) : null);

    // ── Fields the offer requires — missing means missing, never a stand-in value ──
    // No "Unknown" city, no PL→DE countries, no "today" pickup, no EUR: such an
    // offer would look real and flow into LTL and statistics (docs/decisions.md §2).
    // A missing field = 400 EMAIL_OFFER_FIELDS_MISSING and no offer;
    // the forwarder enters the offer by hand (the new-offer form).
    const pickupCity      = email.extractedPickupCity ?? null;
    const deliveryCity    = email.extractedDeliveryCity ?? null;
    const pickupCountry   = email.extractedPickupCountry ?? null;
    const deliveryCountry = email.extractedDeliveryCountry ?? null;
    const pickupDate      = email.extractedDate ?? null;
    const price           = email.extractedPrice ?? null;
    // Currency: from the LLM; otherwise the one the regex found next to THE SAME price in the text.
    // Without a price a currency describes nothing — the offer gets the company's currency (LTL computes the threshold price in it).
    const currency: string | null = this.llmCurrency(email)
      ?? (price !== null ? this.textCurrency(email) : await companyCurrency(this.prisma, companyId));

    const missing = Object.entries({ pickupCity, pickupCountry, deliveryCity, deliveryCountry, pickupDate, currency })
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    if (missing.length > 0) {
      const m = msg('EMAIL_OFFER_FIELDS_MISSING', { fields: missing.join(',') });
      throw new BadRequestException({ statusCode: 400, ...m, message: m.code });
    }
    // Reject a clearly contradictory labeled delivery city before creating an offer.
    const hasLabeledDelivery = /(?:^|[^\\p{L}])(?:rozładunek|unloading|delivery|dostawa|wydanie)[:\\s]+/imu.test(
      `${email.subject}\n${email.body}`,
    );
    if (hasLabeledDelivery && deliveryCity) {
      const source = this.regexClassifier.classify(email.subject, email.body, email.fromEmail);
      const normalizeCity = (value: string) => value
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .trim()
        .toLocaleLowerCase('pl');

      if (source.extractedDeliveryCity &&
          normalizeCity(source.extractedDeliveryCity) !== normalizeCity(deliveryCity)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'EMAIL_OFFER_ROUTE_CONFLICT',
          message: 'EMAIL_OFFER_ROUTE_CONFLICT',
        });
      }
    }

    // A price from the e-mail beyond DECIMAL(10,2) overflowed the column → 500.
    // Now 400 naming the field; the e-mail stays without an offer.
    if (price !== null && !fitsMoneyColumn(price)) {
      const m = msg('OFFER_VALUE_OUT_OF_RANGE', { field: 'price' });
      throw new BadRequestException({ statusCode: 400, ...m, message: m.code });
    }

    const isAdr      = llm['isAdr']    === true;
    const adrClass   = str('adrClass');
    const isFrigo    = llm['temperatureMin'] != null
                    || llm['temperatureMax'] != null
                    || ['frigo', 'chłodnia'].includes(String(llm['vehicleType'] ?? '').toLowerCase());
    const temperatureMin  = num('temperatureMin');
    const temperatureMax  = num('temperatureMax');
    const palletExchange  = llm['palletExchange'] === true;
    const palletCount     = num('palletCount');
    const paymentTermDays = num('paymentTermDays');
    const contactPhone    = str('contactPhone');
    // An unreadable date from the LLM is no date, not an "Invalid Date" in the database.
    const deliveryDateText = str('deliveryDate');
    const parsedDelivery  = deliveryDateText ? new Date(deliveryDateText) : null;
    const deliveryDate    = parsedDelivery && !Number.isNaN(parsedDelivery.getTime()) ? parsedDelivery : null;
    const pickupPostal    = str('pickupPostal');
    const deliveryPostal  = str('deliveryPostal');

    // Client name: prefer fromName, then LLM contactName, then companyName, then email
    const clientName =
      email.fromName ??
      str('contactName') ??
      str('companyName') ??
      email.fromEmail;

    // The offer and its link to the e-mail in one transaction. The link is
    // conditional (createdOfferId as it was when read): when a parallel request
    // got there first, the transaction rolls back and this offer is not created.
    // Cost, profit and margin through offerCost. An e-mail gives no distance,
    // so usually no cost (OFFER_COST_NO_DISTANCE) — empty fields.
    const economics = await economicsFor(this.prisma, companyId, {
      price, currency: currency!, distanceKm: null, tollCostEstimate: null,
    });
    const created = await this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.create({
        data: {
          companyId,
          ...economics,
          source:         'EMAIL',
          status:         'NEW',
          pickupCity:      pickupCity!,
          pickupCountry:   pickupCountry!,
          pickupPostal,
          deliveryCity:    deliveryCity!,
          deliveryCountry: deliveryCountry!,
          deliveryPostal,
          pickupDate:      pickupDate!,
          deliveryDate,
          weightKg:       email.extractedWeight ?? null,
          // A null check, not a truthiness test: a price of 0 is a price, not a missing price.
          price:          price !== null ? String(price) : null,
          currency:       currency!,
          clientName,
          contactEmail:   email.fromEmail,
          contactPhone,
          isAdr,
          adrClass,
          isFrigo,
          temperatureMin,
          temperatureMax,
          palletExchange,
          palletCount,
          paymentTermDays,
          notes: `Utworzono z e-maila: ${email.subject}\n\n${email.body.slice(0, 500)}`,
        },
      });

      const claimed = await tx.emailMessage.updateMany({
        // `?? null`: in Prisma, `undefined` in `where` means "no condition" — the guard would disappear.
        where: { id: emailId, companyId, createdOfferId: email.createdOfferId ?? null },
        data: { createdOfferId: offer.id, isRead: true },
      });
      if (claimed.count === 0) {
        const now = await tx.emailMessage.findFirst({ where: { id: emailId, companyId }, select: { createdOfferId: true } });
        throw offerExists(now?.createdOfferId ?? null);
      }

      return { offer, email };
    });
    // After the transaction commits — a rolled-back one (another tab was
    // first) gives no notifications.
    this.offers.afterOfferCreated(companyId, created.offer);
    return created;
  }

  // ── Update (notes / tags) ─────────────────────────────────────────────────

  async updateEmail(emailId: string, companyId: string, dto: UpdateEmailDto) {
    const email = await this.prisma.emailMessage.findFirst({
      where: { id: emailId, companyId },
    });
    if (!email) throw new NotFoundException('Email nie znaleziony');

    return this.prisma.emailMessage.update({
      where: { id: emailId },
      data: {
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.tags && { tags: dto.tags }),
      },
    });
  }

  // ── Mark read ────────────────────────────────────────────────────────────

  async markRead(emailId: string, companyId: string) {
    const email = await this.prisma.emailMessage.findFirst({
      where: { id: emailId, companyId },
    });
    if (!email) throw new NotFoundException('Email nie znaleziony');
    return this.prisma.emailMessage.update({
      where: { id: emailId },
      data: { isRead: true },
    });
  }

  // ── Toggle star ──────────────────────────────────────────────────────────

  async toggleStar(emailId: string, companyId: string) {
    const email = await this.prisma.emailMessage.findFirst({
      where: { id: emailId, companyId },
    });
    if (!email) throw new NotFoundException('Email nie znaleziony');
    return this.prisma.emailMessage.update({
      where: { id: emailId },
      data: { isStarred: !email.isStarred },
    });
  }
}
