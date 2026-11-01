/**
 * The e-mail inbox: an offer from an e-mail like any new offer, the true price
 * currency, pages.
 *
 * Before: an offer from an e-mail did not go to the matching against demands
 * (no notifications) and did not clear the cached offer list (30 s of a stale
 * list); the screen wrote "EUR" next to every price, though the classifier
 * also recognises PLN; the inbox showed only the first page.
 * Now:
 *  - after the transaction commits, `OffersService.afterOfferCreated` —
 *    matching and the cache, as for the form and the import;
 *  - `extractedCurrency` at read time: an e-mail with an offer → the offer
 *    currency (the truth); no offer (or the offer deleted) → the model's
 *    currency, otherwise the regex currency next to the same price; none → null;
 *  - `page` as in the other lists; `offset` (the page number, the old name)
 *    stays, and with both at once `page` wins.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EmailAgentService } from '../../src/email-agent/email-agent.service';
import { InboxQueryDto } from '../../src/email-agent/dto/inbox-query.dto';
import { OffersService } from '../../src/offers/offers.service';

const BASE = {
  companyId: 'c', subject: 'Transport', fromName: null, fromEmail: 'n@spedycja.example.com', body: 'Fracht 1200 PLN',
  extractedPickupCity: 'Poznan', extractedPickupCountry: 'PL', extractedDeliveryCity: 'Berlin', extractedDeliveryCountry: 'DE',
  extractedWeight: null, extractedDate: new Date('2030-10-12T08:00:00Z'), createdOfferId: null, llmExtractedData: null,
};
const mail = (id: string, over: object = {}) => ({ id, ...BASE, extractedPrice: 1200, ...over });

function make(opts: { emails?: any[]; offers?: any[]; regex?: object; claimed?: number } = {}) {
  const emails = opts.emails ?? [];
  const prisma: any = {
    emailMessage: {
      findMany: jest.fn(async () => emails),
      count: jest.fn(async () => emails.length),
      findFirst: jest.fn(async ({ where }: any) => emails.find((e) => e.id === where.id) ?? null),
      updateMany: jest.fn(async () => ({ count: opts.claimed ?? 1 })),
    },
    offer: {
      findMany: jest.fn(async ({ where }: any) => (opts.offers ?? []).filter((o) => where.id.in.includes(o.id) && o.companyId === where.companyId)),
      findFirst: jest.fn(async ({ where }: any) => (opts.offers ?? []).find((o) => o.id === where.id && o.companyId === where.companyId) ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 'off-new', ...data })),
    },
    company: { findUnique: async () => ({ costCurrency: 'PLN' }) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const regex: any = { classify: jest.fn(() => ({ extractedPrice: 1200, extractedCurrency: 'PLN', ...opts.regex })) };
  const offers: any = { afterOfferCreated: jest.fn() };
  const svc = new EmailAgentService(prisma, regex, { isAvailable: false } as any, { enqueue: (fn: any) => fn() } as any, offers);
  return { svc, prisma, offers, regex };
}
const currencies = async (m: ReturnType<typeof make>) =>
  (await m.svc.getInbox('c', {} as any)).data.map((e: any) => [e.id, e.extractedCurrency]);

describe('an offer from an e-mail is a new offer like any other', () => {
  it('after the transaction: demand matching and the offer cache, once, with the saved offer', async () => {
    const m = make({ emails: [mail('m1')] });
    const { offer } = await m.svc.createOfferFromEmail('m1', 'c');
    expect(m.offers.afterOfferCreated.mock.calls).toEqual([['c', offer]]);
  });

  it('the transaction rolled back (another tab was first): no matching, no cache refresh', async () => {
    const m = make({ emails: [mail('m1')], claimed: 0 });
    await expect(m.svc.createOfferFromEmail('m1', 'c')).rejects.toBeTruthy();
    expect(m.offers.afterOfferCreated).not.toHaveBeenCalled();
  });

  it('OffersService.afterOfferCreated queues the demand matching and clears the company offer cache', async () => {
    const demands: any = { checkNewOfferAgainstDemands: jest.fn(async () => undefined) };
    const cache: any = { deleteByPrefix: jest.fn() };
    const svc = new OffersService({} as any, demands, cache, { enqueue: (fn: any) => fn() } as any);
    svc.afterOfferCreated('c', { id: 'o1' } as any);
    await Promise.resolve();
    expect([demands.checkNewOfferAgainstDemands.mock.calls, cache.deleteByPrefix.mock.calls]).toEqual([[['c', { id: 'o1' }]], [['offers:c']]]);
  });
});

describe('the currency of the price, at read time', () => {
  it('an e-mail with an offer → the offer currency, even when the model said otherwise', async () => {
    const m = make({
      emails: [mail('m1', { createdOfferId: 'o1', llmExtractedData: { currency: 'EUR' } })],
      offers: [{ id: 'o1', companyId: 'c', currency: 'PLN' }],
    });
    expect(await currencies(m)).toEqual([['m1', 'PLN']]);
    expect(m.regex.classify).not.toHaveBeenCalled();
  });

  it('the offer is looked up in the caller\'s company only; an offer of another company does not count', async () => {
    const m = make({
      emails: [mail('m1', { createdOfferId: 'o1', llmExtractedData: { currency: 'EUR' } })],
      offers: [{ id: 'o1', companyId: 'other', currency: 'GBP' }],
    });
    expect(await currencies(m)).toEqual([['m1', 'EUR']]);
    expect(m.prisma.offer.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['o1'] }, companyId: 'c' });
  });

  it('the offer was deleted (a dead link) → the rule for an e-mail without an offer', async () => {
    const m = make({ emails: [mail('m1', { createdOfferId: 'gone' })] });
    expect(await currencies(m)).toEqual([['m1', 'PLN']]);
  });

  it('no offer: the model currency first, then the regex currency at the same price, else null', async () => {
    const m = make({
      emails: [
        mail('llm', { llmExtractedData: { currency: 'EUR' } }),
        mail('regex'),
        mail('other-price', { extractedPrice: 999 }),
        mail('no-price', { extractedPrice: null }),
      ],
    });
    expect(await currencies(m)).toEqual([['llm', 'EUR'], ['regex', 'PLN'], ['other-price', null], ['no-price', null]]);
  });

  it('no "EUR" by default: no currency found in the text → null', async () => {
    const m = make({ emails: [mail('m1')], regex: { extractedCurrency: undefined } });
    expect(await currencies(m)).toEqual([['m1', null]]);
  });

  it('the list still sends no e-mail body and no model JSON (read only for the currency)', async () => {
    const m = make({ emails: [mail('m1', { llmExtractedData: { currency: 'EUR' } })] });
    const [item] = (await m.svc.getInbox('c', {} as any)).data as any[];
    expect([item.body, item.llmExtractedData, item.extractedCurrency]).toEqual([undefined, undefined, 'EUR']);
  });

  it('the e-mail detail carries the same currency', async () => {
    const m = make({ emails: [mail('m1', { createdOfferId: 'o1' })], offers: [{ id: 'o1', companyId: 'c', currency: 'GBP' }] });
    expect((await m.svc.getEmail('m1', 'c')).extractedCurrency).toBe('GBP');
  });
});

describe('inbox pages', () => {
  const skip = async (q: object) => {
    const m = make();
    const r = await m.svc.getInbox('c', q as any);
    const call = m.prisma.emailMessage.findMany.mock.calls[0][0];
    return [call.skip, call.take, r.meta.page];
  };
  it.each([
    ['page=3', { page: '3' }, [40, 20, 3]],
    ['offset=2 (the old name of the page number)', { offset: '2' }, [20, 20, 2]],
    ['page and offset at once → page wins', { page: '3', offset: '2' }, [40, 20, 3]],
    ['nothing → page 1', {}, [0, 20, 1]],
    ['page=2, limit=50', { page: '2', limit: '50' }, [50, 50, 2]],
  ])('%s', async (_n, q, expected) => {
    expect(await skip(q)).toEqual(expected);
  });

  it('page is checked like offset: digits only', () => {
    const errors = validateSync(plainToInstance(InboxQueryDto, { page: '-1' }));
    expect(errors.map((e) => e.property)).toEqual(['page']);
  });
});
