/**
 * Timocom — no built-in implementation.
 *
 * The repository holds only the `ExchangeAdapter` port (like `TOLL_PROVIDER`):
 * `null` by default, so publishing with `publishToTimocom` answers
 * `success: false` with TIMOCOM_NOT_IMPLEMENTED and nothing is sent. A plugged-in
 * adapter publishes with the account of the company in `companyId`. Nothing
 * reads an account from the environment (one account for every company, while
 * anyone can register a company, would let any company publish on it).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ExchangePublisherService, PublishOfferInput } from '../../src/exchange-publisher/exchange-publisher.service';
import { ExchangePublisherModule } from '../../src/exchange-publisher/exchange-publisher.module';
import { ExchangeAdapter, TIMOCOM_ADAPTER } from '../../src/exchange-publisher/exchange-adapter';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const INPUT: PublishOfferInput = {
  companyId: 'comp-1', originCountry: 'PL', originCity: 'Poznań', destCountry: 'DE', destCity: 'Berlin',
  loadingDateFrom: '2026-10-12T08:00:00Z', loadingDateTo: '2026-10-12T16:00:00Z', weightKg: 12000, publishToTimocom: true,
};

function setup(adapter: ExchangeAdapter | null) {
  const prisma: any = { publishedOffer: { create: jest.fn(async ({ data }: any) => data) } };
  const transEuAuth: any = { getValidAccessToken: jest.fn(async () => { throw new Error('no connection'); }) };
  return { service: new ExchangePublisherService(prisma, transEuAuth, adapter), prisma };
}

describe('Timocom without an adapter (the default)', () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  afterEach(() => fetchSpy.mockClear());

  it('publishToTimocom → success: false, TIMOCOM_NOT_IMPLEMENTED; nothing sent, nothing saved', async () => {
    const { service, prisma } = setup(null);
    expect(await service.publishOffer(INPUT)).toEqual([{ exchange: 'TIMOCOM', success: false, code: 'TIMOCOM_NOT_IMPLEMENTED' }]);
    expect([fetchSpy.mock.calls.length, prisma.publishedOffer.create.mock.calls.length]).toEqual([0, 0]);
  });

  it('TIMOCOM_* in the environment changes nothing — nothing reads them', async () => {
    Object.assign(process.env, { TIMOCOM_ID: 'x', TIMOCOM_PASSWORD: 'y', TIMOCOM_GROUP_ID: 'z' });
    try {
      const { service } = setup(null);
      expect((await service.publishOffer(INPUT))[0].code).toBe('TIMOCOM_NOT_IMPLEMENTED');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      delete process.env.TIMOCOM_ID; delete process.env.TIMOCOM_PASSWORD; delete process.env.TIMOCOM_GROUP_ID;
    }
  });

  it('the module registers no adapter', () => {
    const providers: any[] = Reflect.getMetadata('providers', ExchangePublisherModule);
    expect(providers.find((p) => p?.provide === TIMOCOM_ADAPTER)).toEqual({ provide: TIMOCOM_ADAPTER, useValue: null });
  });

  it('no source file reads TIMOCOM_* or calls the Timocom API', () => {
    const files: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') && files.push(path.join(d, e.name))));
    walk(path.join(__dirname, '../../src'));
    expect(files.filter((f) => /TIMOCOM_(ID|PASSWORD|GROUP_ID)|api\.timocom\.com/.test(fs.readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('the code has a place in the message list (and so in the PL/EN dictionary)', () => {
    expect(PLAN_MESSAGE_CODES).toContain('TIMOCOM_NOT_IMPLEMENTED');
  });

  it('Trans.eu is still tried on its own, first', async () => {
    const { service } = setup(null);
    const r = await service.publishOffer({ ...INPUT, publishToTransEu: true });
    expect(r.map((x) => [x.exchange, x.success, x.code])).toEqual([['TRANS_EU', false, undefined], ['TIMOCOM', false, 'TIMOCOM_NOT_IMPLEMENTED']]);
  });
});

describe('Timocom with an adapter plugged in', () => {
  it('the adapter gets the whole input with the caller\'s company; its offer id is saved for that company', async () => {
    const adapter = { publish: jest.fn(async () => ({ offerId: 'T-77' })) };
    const { service, prisma } = setup(adapter);
    expect(await service.publishOffer(INPUT)).toEqual([{ exchange: 'TIMOCOM', success: true, offerId: 'T-77' }]);
    expect(adapter.publish).toHaveBeenCalledWith(INPUT);
    expect(prisma.publishedOffer.create.mock.calls[0][0].data).toMatchObject({ companyId: 'comp-1', exchange: 'TIMOCOM', externalOfferId: 'T-77' });
  });

  it('an adapter error → success: false with its message, nothing saved', async () => {
    const { service, prisma } = setup({ publish: async () => { throw new Error('account not linked'); } });
    expect(await service.publishOffer(INPUT)).toEqual([{ exchange: 'TIMOCOM', success: false, error: 'account not linked' }]);
    expect(prisma.publishedOffer.create).not.toHaveBeenCalled();
  });
});
