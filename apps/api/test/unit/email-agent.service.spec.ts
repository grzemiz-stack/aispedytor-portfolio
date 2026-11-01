/**
 * EmailAgentService — classification with a fallback, mapping an e-mail to an offer, statistics.
 *
 * One Prisma call in this service is still cast to `any` (`emailMessage.create` in
 * `processEmail`). The cast hides that `UnifiedClassification.category` is a `string`
 * while the database column is an enum. The `classify` and `processEmail` tests touch
 * exactly that boundary.
 *
 * Most of what `createOfferFromEmail` does is mapping the LLM's JSON onto offer
 * columns — a dozen decisions about what is missing data and what is a value.
 * `updateEmail`, `markRead` and `toggleStar` are thin delegates and are not tested here.
 *
 * Network: the LLM classifier is a stub; there are no external calls.
 */
import { Prisma } from '@prisma/client';
import { EmailAgentService } from '../../src/email-agent/email-agent.service';
import { EmailClassifierService } from '../../src/email-agent/email-classifier.service';

const EMAIL = {
  id: 'mail-1',
  companyId: 'comp-1',
  subject: 'Transport Poznan - Berlin',
  fromName: null,
  fromEmail: 'nadawca@spedycja.example.com',
  body: 'Tresc zapytania',
  // The fields an offer requires are present — the missing-field tests set them to null explicitly.
  extractedPickupCity: 'Poznan',
  extractedPickupCountry: 'PL',
  extractedDeliveryCity: 'Berlin',
  extractedDeliveryCountry: 'DE',
  extractedWeight: null,
  extractedPrice: null,
  extractedDate: new Date('2026-10-12T08:00:00Z'),
  llmExtractedData: null,
};

const REGEX_CLASSIFICATION = {
  category: 'OFFER',
  priority: 'HIGH',
  tags: ['ADR'],
  confidence: 70,
  reasoning: 'slowa kluczowe',
};

function makeService(opts: {
  email?: Record<string, any> | null;
  llmDostepny?: boolean;
  llmWynik?: any;
  llmBlad?: Error;
  emaile?: any[];
} = {}) {
  const email = opts.email === null ? null : { ...EMAIL, ...(opts.email ?? {}) };
  const prisma: any = {
    emailMessage: {
      create: jest.fn(async ({ data }: any) => ({ id: 'mail-nowy', ...data })),
      findFirst: jest.fn().mockResolvedValue(email),
      findMany: jest.fn().mockResolvedValue(opts.emaile ?? []),
      count: jest.fn().mockResolvedValue((opts.emaile ?? []).length),
      update: jest.fn(async ({ data }: any) => ({ id: 'mail-1', ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    offer: {
      create: jest.fn(async ({ data }: any) => ({ id: 'off-nowa', ...data })),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    company: { findUnique: jest.fn().mockResolvedValue({ costCurrency: 'PLN' }) },
  };
  // Interactive transaction: the callback gets the same client (rolling back is Prisma's job).
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const regexClassifier: any = { classify: jest.fn().mockReturnValue({ ...REGEX_CLASSIFICATION }) };
  const llmClassifier: any = {
    isAvailable: opts.llmDostepny ?? false,
    classifyWithLLM: jest.fn(async () => {
      if (opts.llmBlad) throw opts.llmBlad;
      return opts.llmWynik ?? {};
    }),
  };
  const queue: any = { enqueue: (fn: () => Promise<any>) => fn() };
  return {
    // What a new offer sets off (matching, the list cache) — email-inbox.spec.ts.
    service: new EmailAgentService(prisma, regexClassifier, llmClassifier, queue, { afterOfferCreated: jest.fn() } as any),
    prisma, regexClassifier, llmClassifier,
  };
}

const createdOfferData = (prisma: any) => prisma.offer.create.mock.calls[0][0].data;

describe('classify — LLM with a regex fallback', () => {
  it('without an API key it goes straight to the regex classifier', async () => {
    const { service, regexClassifier, llmClassifier } = makeService({ llmDostepny: false });
    const { classification } = await service.simulateClassification({
      subject: 't', body: 'b', fromEmail: 'a@b.example.com',
    });

    expect(classification.method).toBe('regex');
    expect(regexClassifier.classify).toHaveBeenCalled();
    expect(llmClassifier.classifyWithLLM).not.toHaveBeenCalled();
  });

  it('with the LLM available the result comes from the model', async () => {
    const { service, regexClassifier } = makeService({
      llmDostepny: true,
      llmWynik: { category: 'INVOICE', priority: 'LOW', tags: [], confidence: 95 },
    });
    const { classification } = await service.simulateClassification({
      subject: 't', body: 'b', fromEmail: 'a@b.example.com',
    });

    expect(classification.method).toBe('llm');
    expect(classification.category).toBe('INVOICE');
    expect(regexClassifier.classify).not.toHaveBeenCalled();
  });

  it('an LLM error falls back to the regex classifier instead of failing the request', async () => {
    const { service, regexClassifier } = makeService({
      llmDostepny: true,
      llmBlad: new Error('529 overloaded'),
    });
    const { classification } = await service.simulateClassification({
      subject: 't', body: 'b', fromEmail: 'a@b.example.com',
    });

    expect(classification.method).toBe('regex');
    expect(classification.category).toBe('OFFER');
    expect(regexClassifier.classify).toHaveBeenCalled();
  });

  it('simulation saves nothing to the database', async () => {
    const { service, prisma } = makeService();
    await service.simulateClassification({ subject: 't', body: 'b', fromEmail: 'a@b.example.com' });

    expect(prisma.emailMessage.create).not.toHaveBeenCalled();
  });
});

describe('processEmail — what reaches the database', () => {
  it('category and priority from the classification go to the enum columns', async () => {
    const { service, prisma } = makeService();
    await service.processEmail({
      subject: 't', body: 'b', fromEmail: 'a@b.example.com', toEmail: 'ja@firma.example.com',
    }, 'comp-1');

    const data = prisma.emailMessage.create.mock.calls[0][0].data;
    expect(data.category).toBe('OFFER');
    expect(data.priority).toBe('HIGH');
  });

  it('no receivedAt gives the current date', async () => {
    const { service, prisma } = makeService();
    await service.processEmail({
      subject: 't', body: 'b', fromEmail: 'a@b.example.com', toEmail: 'ja@firma.example.com',
    }, 'comp-1');

    expect(prisma.emailMessage.create.mock.calls[0][0].data.receivedAt).toBeInstanceOf(Date);
  });

  it('a given receivedAt is converted to a Date', async () => {
    const { service, prisma } = makeService();
    await service.processEmail({
      subject: 't', body: 'b', fromEmail: 'a@b.example.com', toEmail: 'ja@firma.example.com',
      receivedAt: '2026-03-15T10:00:00.000Z',
    }, 'comp-1');

    const d = prisma.emailMessage.create.mock.calls[0][0].data.receivedAt;
    expect(d.toISOString()).toBe('2026-03-15T10:00:00.000Z');
  });

  it('regex classification has no LLM fields — they are saved as NULL', async () => {
    const { service, prisma } = makeService({ llmDostepny: false });
    await service.processEmail({
      subject: 't', body: 'b', fromEmail: 'a@b.example.com', toEmail: 'ja@firma.example.com',
    }, 'comp-1');

    const data = prisma.emailMessage.create.mock.calls[0][0].data;
    expect(data.llmSummary).toBeNull();
    expect(data.llmCategory).toBeNull();
    // A JSON column: SQL NULL is `Prisma.DbNull` in Prisma (`null` alone would store a JSON null).
    expect(data.llmExtractedData).toBe(Prisma.DbNull);
  });
});

describe('createOfferFromEmail — a price outside the column range', () => {
  it.each([100_000_000, -5])('price %p → 400 OFFER_VALUE_OUT_OF_RANGE, no offer (before: 500)', async (price) => {
    const { service, prisma } = makeService({ email: { extractedPrice: price, llmExtractedData: { currency: 'EUR' } } });
    await expect(service.createOfferFromEmail('mail-1', 'comp-1')).rejects.toMatchObject({ response: { statusCode: 400, code: 'OFFER_VALUE_OUT_OF_RANGE', params: { field: 'price' } } });
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  it('exactly 99,999,999.99 fits', async () => {
    const { service, prisma } = makeService({ email: { extractedPrice: 99_999_999.99, llmExtractedData: { currency: 'EUR' } } });
    await service.createOfferFromEmail('mail-1', 'comp-1');
    expect(createdOfferData(prisma).price).toBe('99999999.99');
  });
});

describe('createOfferFromEmail — validation against source email', () => {
  it('rejects an extracted delivery city contradicted by the original email', async () => {
    const { service, prisma, regexClassifier } = makeService({
      email: {
        subject: 'Transport Poznań - Berlin',
        body: 'Załadunek: Poznań, PL\nRozładunek: Berlin, DE\nData załadunku: 12.10.2026',
        extractedDeliveryCity: 'Hamburg',
      },
    });

    regexClassifier.classify.mockReturnValue({
      ...REGEX_CLASSIFICATION,
      extractedDeliveryCity: 'Berlin',
      extractedDeliveryCountry: 'DE',
    });

    await expect(
      service.createOfferFromEmail('mail-1', 'comp-1'),
    ).rejects.toBeDefined();

    expect(prisma.offer.create).not.toHaveBeenCalled();
  });
});

describe('createOfferFromEmail — real parser integration', () => {
  it('blocks Hamburg when the original email explicitly says Berlin', async () => {
    const { service, prisma, regexClassifier } = makeService({
      email: {
        subject: 'Transport Poznań - Berlin',
        body: 'Załadunek: Poznań, PL\nRozładunek: Berlin, DE\nData załadunku: 12.10.2026',
        extractedDeliveryCity: 'Hamburg',
      },
    });

    const realParser = new EmailClassifierService();
    regexClassifier.classify.mockImplementation(
      (subject: string, body: string, fromEmail: string) =>
        realParser.classify(subject, body, fromEmail),
    );

    await expect(
      service.createOfferFromEmail('mail-1', 'comp-1'),
    ).rejects.toMatchObject({
      response: { code: 'EMAIL_OFFER_ROUTE_CONFLICT' },
    });

    expect(prisma.offer.create).not.toHaveBeenCalled();
    expect(prisma.emailMessage.updateMany).not.toHaveBeenCalled();
  });
});

describe('createOfferFromEmail — valid source route', () => {
  it('accepts Berlin when Hamburg appears only in additional notes', async () => {
    const { service, prisma, regexClassifier } = makeService({
      email: {
        subject: 'Transport Poznań - Berlin',
        body: 'Załadunek: Poznań, PL\\nRozładunek: Berlin, DE\\nKontakt z oddziałem w Hamburgu.',
        extractedDeliveryCity: 'Berlin',
      },
    });

    const realParser = new EmailClassifierService();
    regexClassifier.classify.mockImplementation(
      (subject: string, body: string, fromEmail: string) =>
        realParser.classify(subject, body, fromEmail),
    );

    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).deliveryCity).toBe('Berlin');
    expect(prisma.offer.create).toHaveBeenCalledTimes(1);
  });
});

describe('createOfferFromEmail — mapping the basic fields', () => {
  it('fields from the e-mail go straight into the offer', async () => {
    const { service, prisma } = makeService();
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma)).toMatchObject({
      pickupCity: 'Poznan', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE',
      pickupDate: new Date('2026-10-12T08:00:00Z'),
    });
  });

  it('an e-mail that does not exist ends in NotFound', async () => {
    const { service } = makeService({ email: null });

    await expect(service.createOfferFromEmail('brak', 'comp-1')).rejects.toThrow(/nie znaleziony/i);
  });

  it('creating the offer marks the e-mail as read and links it to the offer', async () => {
    const { service, prisma } = makeService();
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(prisma.emailMessage.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'mail-1', companyId: 'comp-1', createdOfferId: null },
      data: { createdOfferId: 'off-nowa', isRead: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('the client name comes from fromName when present', async () => {
    const { service, prisma } = makeService({ email: { fromName: 'Jan Kowalski' } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).clientName).toBe('Jan Kowalski');
  });

  it('without fromName the client name falls back to contactName from the LLM', async () => {
    const { service, prisma } = makeService({
      email: { fromName: null, llmExtractedData: { contactName: 'Anna Nowak' } },
    });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).clientName).toBe('Anna Nowak');
  });

  it('as a last resort the client name is the sender address', async () => {
    const { service, prisma } = makeService({ email: { fromName: null, llmExtractedData: {} } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).clientName).toBe('nadawca@spedycja.example.com');
  });

  it('the note quotes the subject and cuts the body to 500 characters', async () => {
    const { service, prisma } = makeService({ email: { body: 'x'.repeat(900) } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    const notes = createdOfferData(prisma).notes as string;
    expect(notes).toContain('Transport Poznan - Berlin');
    expect(notes).toContain('x'.repeat(500));
    expect(notes).not.toContain('x'.repeat(501));
  });
});

describe('createOfferFromEmail — mapping data from the LLM', () => {
  it('missing llmExtractedData does not break the mapping', async () => {
    const { service, prisma } = makeService({ email: { llmExtractedData: null } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma)).toMatchObject({
      isAdr: false, adrClass: null, isFrigo: false, palletExchange: false,
      temperatureMin: null, temperatureMax: null, palletCount: null, paymentTermDays: null,
    });
  });

  it('isAdr is set only for an exact true', async () => {
    const { service, prisma } = makeService({ email: { llmExtractedData: { isAdr: 'tak' } } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).isAdr).toBe(false);
  });

  it.each([
    ['a postal code as a number', { pickupPostal: 60001 }, 'pickupPostal', null],
    ['a phone as an object', { contactPhone: { n: 1 } }, 'contactPhone', null],
    ['an ADR class as a number', { adrClass: 3 }, 'adrClass', null],
    ['a pallet count as text', { palletCount: '33' }, 'palletCount', null],
    ['a delivery date as a number', { deliveryDate: 20261015 }, 'deliveryDate', null],
    ['valid text passes', { pickupPostal: '60-001' }, 'pickupPostal', '60-001'],
    ['a valid number passes', { palletCount: 33 }, 'palletCount', 33],
  ])('an LLM field of the wrong type is missing, not a value for the database: %s', async (_n, llmExtractedData, field, expected) => {
    // `?? null` used to pass a number into a text column (Prisma error → 500).
    const { service, prisma } = makeService({ email: { llmExtractedData } });
    await service.createOfferFromEmail('mail-1', 'comp-1');
    expect(createdOfferData(prisma)[field]).toBe(expected);
  });

  it('a temperature sets the reefer flag', async () => {
    const { service, prisma } = makeService({ email: { llmExtractedData: { temperatureMin: 2 } } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).isFrigo).toBe(true);
  });

  it('a temperature of 0°C also sets the reefer flag', async () => {
    const { service, prisma } = makeService({ email: { llmExtractedData: { temperatureMin: 0 } } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma)).toMatchObject({ isFrigo: true, temperatureMin: 0 });
  });

  it('vehicle type frigo sets the reefer flag without a temperature', async () => {
    const { service, prisma } = makeService({ email: { llmExtractedData: { vehicleType: 'FRIGO' } } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).isFrigo).toBe(true);
  });

  it('numbers of the wrong type do not reach the numeric columns', async () => {
    const { service, prisma } = makeService({
      email: { llmExtractedData: { palletCount: '33', paymentTermDays: 'trzydziesci' } },
    });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma)).toMatchObject({ palletCount: null, paymentTermDays: null });
  });

  it('no price and no currency — the company currency, not a hard-coded EUR', async () => {
    const { service, prisma } = makeService({ email: { llmExtractedData: {} } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).currency).toBe('PLN');
    expect(prisma.company.findUnique.mock.calls[0][0].where).toEqual({ id: 'comp-1' });
  });

  it('the currency from the LLM is used', async () => {
    const { service, prisma } = makeService({ email: { llmExtractedData: { currency: 'PLN' } } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).currency).toBe('PLN');
  });

  it('the delivery date from the LLM is converted to a Date', async () => {
    const { service, prisma } = makeService({
      email: { llmExtractedData: { deliveryDate: '2026-04-01' } },
    });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).deliveryDate).toBeInstanceOf(Date);
  });

  it('an unreadable delivery date from the LLM is no date, not an Invalid Date', async () => {
    const { service, prisma } = makeService({ email: { llmExtractedData: { deliveryDate: 'w przyszłym tygodniu' } } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).deliveryDate).toBeNull();
  });

  it('no delivery date gives NULL', async () => {
    const { service, prisma } = makeService({ email: { llmExtractedData: {} } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).deliveryDate).toBeNull();
  });
});

describe('createOfferFromEmail — a missing field stays missing, with a code (no stand-in values)', () => {
  const tryCreateOffer = async (email: Record<string, any>) => {
    const { service, prisma } = makeService({ email });
    let body: any;
    await service.createOfferFromEmail('mail-1', 'comp-1').catch((e: any) => { body = { status: e.getStatus(), ...e.getResponse() }; });
    return { body, prisma };
  };

  it('no cities, countries or pickup date: 400 with the list of fields, no offer, the e-mail untouched', async () => {
    const { body, prisma } = await tryCreateOffer({
      extractedPickupCity: null, extractedDeliveryCity: null,
      extractedPickupCountry: null, extractedDeliveryCountry: null, extractedDate: null,
    });
    expect(body).toEqual({
      status: 400, statusCode: 400, code: 'EMAIL_OFFER_FIELDS_MISSING',
      params: { fields: 'pickupCity,pickupCountry,deliveryCity,deliveryCountry,pickupDate' },
      message: 'EMAIL_OFFER_FIELDS_MISSING',
    });
    expect(prisma.offer.create).not.toHaveBeenCalled();
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
  });

  it('each required field on its own blocks creation', async () => {
    for (const [emailField, offerField] of [
      ['extractedPickupCity', 'pickupCity'], ['extractedPickupCountry', 'pickupCountry'],
      ['extractedDeliveryCity', 'deliveryCity'], ['extractedDeliveryCountry', 'deliveryCountry'],
      ['extractedDate', 'pickupDate'],
    ]) {
      const { body } = await tryCreateOffer({ [emailField]: null });
      expect([emailField, body?.params]).toEqual([emailField, { fields: offerField }]);
    }
  });

  it('a price without a currency (neither from the LLM nor from the text): currency missing, not EUR', async () => {
    const { body } = await tryCreateOffer({ extractedPrice: 1850, llmExtractedData: {} });
    expect(body.params).toEqual({ fields: 'currency' });
  });

  it('a price without a currency from the LLM: the currency the regex found next to the same price in the text', async () => {
    const { service, prisma, regexClassifier } = makeService({ email: { extractedPrice: 1850, body: 'Fracht: 1850 zł' } });
    regexClassifier.classify.mockReturnValue({ ...REGEX_CLASSIFICATION, extractedPrice: 1850, extractedCurrency: 'PLN' });
    await service.createOfferFromEmail('mail-1', 'comp-1');
    expect(createdOfferData(prisma)).toMatchObject({ price: '1850', currency: 'PLN' });
  });

  it('a currency from the text next to a DIFFERENT amount than the offer price is not used', async () => {
    const { service, regexClassifier } = makeService({ email: { extractedPrice: 1850 } });
    regexClassifier.classify.mockReturnValue({ ...REGEX_CLASSIFICATION, extractedPrice: 300, extractedCurrency: 'PLN' });
    const e: any = await service.createOfferFromEmail('mail-1', 'comp-1').catch(x => x.getResponse());
    expect(e.params).toEqual({ fields: 'currency' });
  });
});

describe('createOfferFromEmail — a second time from the same e-mail (idempotent)', () => {
  const conflict = async (p: Promise<unknown>) => {
    try { await p; } catch (e: any) { return { status: e.getStatus(), ...e.getResponse() }; }
    throw new Error('expected a rejection');
  };

  it('the e-mail already has an existing offer: 409 EMAIL_OFFER_EXISTS with its id, nothing new', async () => {
    const { service, prisma } = makeService({ email: { createdOfferId: 'off-stara' } });
    prisma.offer.findFirst.mockResolvedValue({ id: 'off-stara' });

    expect(await conflict(service.createOfferFromEmail('mail-1', 'comp-1'))).toEqual({
      status: 409, statusCode: 409, code: 'EMAIL_OFFER_EXISTS', params: { offerId: 'off-stara' }, message: 'EMAIL_OFFER_EXISTS',
    });
    expect(prisma.offer.findFirst.mock.calls[0][0].where).toEqual({ id: 'off-stara', companyId: 'comp-1' });
    expect(prisma.offer.create).not.toHaveBeenCalled();
    expect(prisma.emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it('the offer the e-mail pointed to was deleted: a dead link, a new offer may be created', async () => {
    const { service, prisma } = makeService({ email: { createdOfferId: 'off-usunieta' } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(prisma.offer.create).toHaveBeenCalledTimes(1);
    expect(prisma.emailMessage.updateMany.mock.calls[0][0].where.createdOfferId).toBe('off-usunieta');
  });

  it('a parallel request got there first: the link is not set, 409 with the offer of the winning request — the transaction rolls back', async () => {
    const { service, prisma } = makeService();
    prisma.emailMessage.updateMany.mockResolvedValue({ count: 0 });
    prisma.emailMessage.findFirst
      .mockResolvedValueOnce({ ...EMAIL })                    // read at the start
      .mockResolvedValueOnce({ createdOfferId: 'off-zwyciezcy' }); // after the failed link

    expect(await conflict(service.createOfferFromEmail('mail-1', 'comp-1'))).toMatchObject({
      status: 409, code: 'EMAIL_OFFER_EXISTS', params: { offerId: 'off-zwyciezcy' },
    });
    // The exception came from inside the transaction callback — that is what rolls back the created offer.
    await expect(prisma.$transaction.mock.results[0].value).rejects.toMatchObject({ status: 409 });
  });
});

describe('createOfferFromEmail — weight and price', () => {
  it('weight is carried over as is', async () => {
    const { service, prisma } = makeService({ email: { extractedWeight: 24000 } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).weightKg).toBe(24000);
  });

  it('a weight of 0 stays 0 — zero is not missing data', async () => {
    const { service, prisma } = makeService({ email: { extractedWeight: 0 } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).weightKg).toBe(0);
  });

  it('the price is carried over as a string', async () => {
    const { service, prisma } = makeService({ email: { extractedPrice: 1850, llmExtractedData: { currency: 'EUR' } } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).price).toBe('1850');
  });

  it('no price gives NULL', async () => {
    const { service, prisma } = makeService({ email: { extractedPrice: null } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).price).toBeNull();
  });

  it('a price of 0 stays 0 — zero is not a missing price', async () => {
    // A truthiness test (`price: extractedPrice ? String(...) : null`) would lose the
    // zero, while `weightKg` next to it keeps it. 0 is a value (docs/decisions.md §2).
    const { service, prisma } = makeService({ email: { extractedPrice: 0, llmExtractedData: { currency: 'EUR' } } });
    await service.createOfferFromEmail('mail-1', 'comp-1');

    expect(createdOfferData(prisma).price).toBe('0');
  });
});

describe('getInbox — building the filters', () => {
  it('the response is { data, meta } — the e-mail screen reads it through pageItems (web/src/lib/paginated.ts)', async () => {
    const { service } = makeService({ emaile: [{ id: 'm-1' }, { id: 'm-2' }] } as any);
    const r: any = await service.getInbox('comp-1', {});

    expect(Object.keys(r).sort()).toEqual(['data', 'meta']);
    expect(r.data.map((e: any) => e.id)).toEqual(['m-1', 'm-2']);
    expect(r.meta.total).toBe(2);
  });

  it('no filters leaves only companyId', async () => {
    const { service, prisma } = makeService();
    await service.getInbox('comp-1', {});

    expect(prisma.emailMessage.findMany.mock.calls[0][0].where).toEqual({ companyId: 'comp-1' });
  });

  it('category ALL does not narrow the result', async () => {
    const { service, prisma } = makeService();
    await service.getInbox('comp-1', { category: 'ALL' });

    expect(prisma.emailMessage.findMany.mock.calls[0][0].where).toEqual({ companyId: 'comp-1' });
  });

  it('a specific category goes into WHERE', async () => {
    const { service, prisma } = makeService();
    await service.getInbox('comp-1', { category: 'OFFER' });

    expect(prisma.emailMessage.findMany.mock.calls[0][0].where.category).toBe('OFFER');
  });

  it('the flags work only for the literal "true"', async () => {
    const { service, prisma } = makeService();
    await service.getInbox('comp-1', { unreadOnly: 'false', starred: '1' });

    const where = prisma.emailMessage.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('isRead');
    expect(where).not.toHaveProperty('isStarred');
  });

  it('the search phrase is matched against four columns, case-insensitive', async () => {
    const { service, prisma } = makeService();
    await service.getInbox('comp-1', { search: 'Berlin' });

    const or = prisma.emailMessage.findMany.mock.calls[0][0].where.OR;
    expect(or).toHaveLength(4);
    expect(or.every((w: any) => (Object.values(w)[0] as any)?.mode === 'insensitive')).toBe(true);
  });

  it('limit is capped at 100', async () => {
    const { service, prisma } = makeService();
    await service.getInbox('comp-1', { limit: '5000' });

    expect(prisma.emailMessage.findMany.mock.calls[0][0].take).toBe(100);
  });
});

describe('getStats — counting', () => {
  const storedEmails = [
    { category: 'OFFER', isRead: false, priority: 'HIGH', createdOfferId: null },
    { category: 'OFFER', isRead: true, priority: 'HIGH', createdOfferId: 'off-1' },
    { category: 'INVOICE', isRead: true, priority: 'LOW', createdOfferId: null },
  ];

  it('totals and breakdowns match the data', async () => {
    const { service } = makeService({ emaile: storedEmails });
    const s = await service.getStats('comp-1');

    expect(s).toMatchObject({
      total: 3,
      unread: 1,
      offersToReview: 1, // OFFER without a created offer
      byCategory: { OFFER: 2, INVOICE: 1 },
      byPriority: { HIGH: 2, LOW: 1 },
    });
  });

  it('no saved e-mails gives zeros and empty breakdowns', async () => {
    const { service } = makeService({ emaile: [] });
    const s = await service.getStats('comp-1');

    expect(s).toEqual({ total: 0, unread: 0, offersToReview: 0, byCategory: {}, byPriority: {} });
  });
});
