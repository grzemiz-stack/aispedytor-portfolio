/**
 * A contractor's risk ratings are saved.
 *
 * `paymentRating` (1–5) and `reliabilityScore` (0–100) drive
 * COUNTERPARTY_RISK on the LTL card and in negotiation (common/counterparty-risk.ts).
 * The DTO validates them; create and update must also write them, otherwise
 * the request answers 200 while the database keeps null and the risk can never be set.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContractorsService } from '../../src/contractors/contractors.service';
import { CreateContractorDto } from '../../src/contractors/dto/create-contractor.dto';
import { UpdateContractorDto } from '../../src/contractors/dto/update-contractor.dto';
import { counterpartyRisk } from '../../src/common/counterparty-risk';

function setup() {
  const rows: any[] = [];
  const prisma: any = {
    contractor: {
      create: jest.fn(async ({ data }: any) => { const r = { id: `c-${rows.length}`, paymentRating: null, reliabilityScore: null, ...data }; rows.push(r); return r; }),
      findFirst: jest.fn(async ({ where }: any) => rows.find(r => r.id === where.id && r.companyId === where.companyId) ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find(r => r.id === where.id), data)),
    },
  };
  const cache: any = { deleteByPrefix: jest.fn() };
  return { service: new ContractorsService(prisma, cache), rows };
}

describe('contractor ratings are saved', () => {
  it('create keeps paymentRating and reliabilityScore — and the risk shows', async () => {
    const { service } = setup();
    const c: any = await service.create('comp-1', { name: 'Ryzykowny', paymentRating: 2, reliabilityScore: 35 });
    expect([c.paymentRating, c.reliabilityScore]).toEqual([2, 35]);
    expect(counterpartyRisk(c)).toEqual(['PAYMENT', 'RELIABILITY']);
  });

  it('update sets them, leaves them when not sent, clears them with null', async () => {
    const { service } = setup();
    const { id } = await service.create('comp-1', { name: 'Firma' });

    let c: any = await service.update(id, 'comp-1', { paymentRating: 5, reliabilityScore: 90 });
    expect([c.paymentRating, c.reliabilityScore]).toEqual([5, 90]);

    c = await service.update(id, 'comp-1', { name: 'Firma 2' });
    expect([c.paymentRating, c.reliabilityScore]).toEqual([5, 90]);

    c = await service.update(id, 'comp-1', { paymentRating: null, reliabilityScore: null } as any);
    expect([c.paymentRating, c.reliabilityScore]).toEqual([null, null]);
  });
});

describe('rating validation — whole numbers in range (Int columns)', () => {
  const bad = async (cls: any, body: object) =>
    (await validate(plainToInstance(cls, body) as object)).map((e: any) => e.property);

  it('accepts the edges', async () => {
    expect(await bad(CreateContractorDto, { name: 'Ab', paymentRating: 1, reliabilityScore: 0 })).toEqual([]);
    expect(await bad(UpdateContractorDto, { paymentRating: 5, reliabilityScore: 100, rating: 3, avgPaymentDays: 0 })).toEqual([]);
  });

  it('rejects out of range and fractions', async () => {
    expect(await bad(UpdateContractorDto, { paymentRating: 6 })).toEqual(['paymentRating']);
    expect(await bad(UpdateContractorDto, { paymentRating: 0 })).toEqual(['paymentRating']);
    expect(await bad(UpdateContractorDto, { reliabilityScore: 101 })).toEqual(['reliabilityScore']);
    expect(await bad(UpdateContractorDto, { paymentRating: 2.5 })).toEqual(['paymentRating']);
    expect(await bad(UpdateContractorDto, { reliabilityScore: 40.5 })).toEqual(['reliabilityScore']);
    expect(await bad(UpdateContractorDto, { rating: 4.5, avgPaymentDays: 14.5 })).toEqual(['rating', 'avgPaymentDays']);
  });
});
