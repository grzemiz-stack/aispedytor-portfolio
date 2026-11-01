/**
 * PATCH /companies/me — the field allow-list.
 *
 * If the controller took `dto: any` and the service wrote it as is, a company
 * administrator could set their own subscription plan and limits.
 * Both layers are checked: validation (the same ValidationPipe as main.ts)
 * and the service, which writes only the listed fields.
 */
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UpdateCompanyDto } from '../../src/companies/dto/update-company.dto';
import { CompaniesService } from '../../src/companies/companies.service';
import { CompaniesController } from '../../src/companies/companies.controller';

// The same configuration as in main.ts — a test below checks that main.ts keeps whitelist + forbidNonWhitelisted.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: object) =>
  pipe.transform(body, { type: 'body', metatype: UpdateCompanyDto, data: '' });


/** A rate change recomputes the open offers — here a company without offers. */
/** The task queue — the offer recompute after a rate change runs in the background. */
const QUEUE: any = { enqueue: (fn: () => Promise<unknown>) => fn() };
const NO_OFFERS = { offer: { findMany: async () => [] }, routeCalculation: { findMany: async () => [] } };
describe('UpdateCompanyDto through the global ValidationPipe', () => {
  it('main.ts still runs the pipe with whitelist + forbidNonWhitelisted', () => {
    const main = readFileSync(resolve(__dirname, '../../src/main.ts'), 'utf8');
    expect(main).toMatch(/whitelist:\s*true/);
    expect(main).toMatch(/forbidNonWhitelisted:\s*true/);
  });

  it.each([
    ['subscriptionPlan', 'ENTERPRISE'],
    ['aiCallsLimit', 100000],
    ['aiCallsToday', 0],
    ['maxDispatchers', 999],
    ['trialEndsAt', '2099-01-01'],
    ['settings', { anything: true }],
    ['id', 'other-company'],
    ['logoBase64', 'data:image/png;base64,AAAA'],
  ])('rejects %s — not on the list', async (field, value) => {
    await expect(validate({ name: 'Firma', [field]: value })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the company data fields', async () => {
    const body = {
      name: 'Trans-Pol Sp. z o.o.',
      taxId: '7792345678',
      regon: '123456789',
      street: 'Głogowska 1',
      city: 'Poznań',
      postalCode: '60-001',
      country: 'PL',
      billingEmail: 'faktury@example.net',
      phone: '+48 600 000 000',
      website: 'https://example.pl',
      costPerKm: 4.2,
      costCurrency: 'EUR',
    };
    await expect(validate(body)).resolves.toMatchObject(body);
  });

  it.each([
    ['empty name', { name: '' }],
    ['null name — required in the database', { name: null }],
    ['lower-case country', { country: 'pl' }],
    ['three-letter country', { country: 'POL' }],
    ['bad e-mail', { billingEmail: 'not-an-email' }],
    ['cost per km 0 — no cost is null, not zero', { costPerKm: 0 }],
    ['negative cost per km', { costPerKm: -1 }],
    ['cost per km with 3 decimals', { costPerKm: 4.123 }],
    ['cost per km as text', { costPerKm: '4.20' }],
    ['cost per km above DECIMAL(10,2)', { costPerKm: 100_000_000 }],
    ['currency outside the list', { costCurrency: 'USD' }],
    ['lower-case currency', { costCurrency: 'pln' }],
    ['null currency — NOT NULL in the database', { costCurrency: null }],
  ])('rejects %s', async (_label, body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows clearing an optional field with null', async () => {
    await expect(validate({ taxId: null })).resolves.toMatchObject({ taxId: null });
  });

  it('allows clearing the cost per km with null — ranking falls back to revenue', async () => {
    await expect(validate({ costPerKm: null })).resolves.toMatchObject({ costPerKm: null });
  });
});

describe('CompaniesService.update — second layer', () => {
  it('writes only listed fields, even when called without the pipe', async () => {
    const prisma: any = { company: { update: jest.fn().mockResolvedValue({}) }, ...NO_OFFERS };
    await new CompaniesService(prisma, QUEUE).update('comp-1', {
      name: 'Firma',
      city: 'Poznań',
      subscriptionPlan: 'ENTERPRISE',
      aiCallsLimit: 100000,
    } as any);
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'comp-1' },
      data: { name: 'Firma', city: 'Poznań' },
    });
  });

  it('an absent field is not written as undefined, a null is written as null', async () => {
    const prisma: any = { company: { update: jest.fn().mockResolvedValue({}) }, ...NO_OFFERS };
    await new CompaniesService(prisma, QUEUE).update('comp-1', { taxId: null, city: undefined } as any);
    expect(prisma.company.update.mock.calls[0][0].data).toEqual({ taxId: null });
  });

  it('writes the cost per km and its currency', async () => {
    const prisma: any = { company: { update: jest.fn().mockResolvedValue({}) }, ...NO_OFFERS };
    await new CompaniesService(prisma, QUEUE).update('comp-1', { costPerKm: 4.2, costCurrency: 'EUR' });
    expect(prisma.company.update.mock.calls[0][0].data).toEqual({ costPerKm: 4.2, costCurrency: 'EUR' });
  });
});

describe('CompaniesService.update — currency change while a cost per km is set', () => {
  /** A company in the database with the given cost and currency. */
  const serviceWith = (current: { costPerKm: number | null; costCurrency: string }) => {
    const prisma: any = {
      ...NO_OFFERS,
      company: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { service: new CompaniesService(prisma, QUEUE), prisma };
  };

  it('PLN 4.20 → GBP without a cost → 400 with a message code, nothing saved', async () => {
    const { service, prisma } = serviceWith({ costPerKm: 4.2, costCurrency: 'PLN' });
    const err = await service.update('comp-1', { costCurrency: 'GBP' }).catch(e => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({
      code: 'COMPANY_CURRENCY_CHANGE_WITHOUT_COST',
      params: { costPerKm: 4.2, fromCurrency: 'PLN', toCurrency: 'GBP' },
    });
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('GBP together with 1.10 → accepted, both written, no lookup needed', async () => {
    const { service, prisma } = serviceWith({ costPerKm: 4.2, costCurrency: 'PLN' });
    await service.update('comp-1', { costCurrency: 'GBP', costPerKm: 1.1 });
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
    expect(prisma.company.update.mock.calls[0][0].data).toEqual({ costCurrency: 'GBP', costPerKm: 1.1 });
  });

  it('currency change with no cost set → accepted', async () => {
    const { service, prisma } = serviceWith({ costPerKm: null, costCurrency: 'PLN' });
    await service.update('comp-1', { costCurrency: 'GBP' });
    expect(prisma.company.update.mock.calls[0][0].data).toEqual({ costCurrency: 'GBP' });
  });

  it('the same currency again → accepted (nothing changes)', async () => {
    const { service, prisma } = serviceWith({ costPerKm: 4.2, costCurrency: 'PLN' });
    await service.update('comp-1', { costCurrency: 'PLN' });
    expect(prisma.company.update).toHaveBeenCalled();
  });

  it('currency change while clearing the cost (null) → accepted', async () => {
    const { service, prisma } = serviceWith({ costPerKm: 4.2, costCurrency: 'PLN' });
    await service.update('comp-1', { costCurrency: 'EUR', costPerKm: null });
    expect(prisma.company.update.mock.calls[0][0].data).toEqual({ costCurrency: 'EUR', costPerKm: null });
  });
});

describe('CompaniesController.update', () => {
  it('declares UpdateCompanyDto as the body type — with `any` the pipe has nothing to check', () => {
    // Nest picks the class to validate from this metadata; `any` gives Object.
    const types = Reflect.getMetadata('design:paramtypes', CompaniesController.prototype, 'update');
    expect(types[0]).toBe(UpdateCompanyDto);
  });
});
