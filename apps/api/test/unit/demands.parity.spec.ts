/**
 * Equivalence of the two ways an offer is matched to a demand.
 *
 *   A) auto-notification — checkNewOfferAgainstDemands(companyId, offer)
 *   B) manual search     — searchOffers(id, companyId, userId)
 *
 * Both get the same input (the same set of offers, the same demand), so both
 * outputs MUST be the same. Every test compares the sets of offer ids.
 *
 * The Prisma mock reproduces PostgreSQL NULL semantics: a row with NULL satisfies
 * neither `IN (...)` nor `<= n`. Without that, the test could not show a real mismatch.
 */
import { DemandsService } from '../../src/demands/demands.service';

type Offer = {
  id: string;
  companyId: string;
  status: string;
  pickupCountry: string | null;
  deliveryCountry?: string | null;
  pickupCity?: string;
  deliveryCity?: string;
  weightKg: number | null;
  isAdr: boolean | null;
  isFrigo: boolean | null;
  price?: number | null;
  currency?: string;
};

type Demand = Record<string, any>;

const demandBase: Demand = {
  id: 'dem-1',
  companyId: 'comp-1',
  dispatcherId: 'user-1',
  title: 'Zapotrzebowanie',
  status: 'OPEN',
  isActive: true,
  autoNotify: true,
  preferredCountries: [] as string[],
  maxWeight: null,
  adrRequired: false,
  temperatureRequired: false,
};

const offerBase: Offer = {
  id: 'off-0',
  companyId: 'comp-1',
  status: 'NEW',
  pickupCountry: 'PL',
  deliveryCountry: 'DE',
  pickupCity: 'Warszawa',
  deliveryCity: 'Berlin',
  weightKg: 12000,
  isAdr: false,
  isFrigo: false,
  price: 1000,
  currency: 'EUR',
};

const offer = (id: string, over: Partial<Offer> = {}): Offer => ({ ...offerBase, id, ...over });

/** Prisma/PostgreSQL `where` semantics for the operators used in searchOffers. */
function matchesWhere(row: any, where: Record<string, any>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) {
        if (value === null || value === undefined) return false; // NULL IN (...) => NULL
        if (!cond.in.includes(value)) return false;
      } else if ('lte' in cond) {
        if (value === null || value === undefined) return false; // NULL <= n => NULL
        if (!(value <= cond.lte)) return false;
      } else {
        throw new Error(`Nieobslugiwany operator where: ${JSON.stringify(cond)}`);
      }
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

/** Path B — manual search. Returns the ids of the offers returned to the user. */
async function manualSearch(offers: Offer[], demand: Demand): Promise<string[]> {
  const prisma: any = {
    dispatcherDemand: {
      findFirst: jest.fn().mockResolvedValue(demand),
      update: jest.fn().mockResolvedValue({}),
    },
    offer: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(offers.filter((o) => matchesWhere(o, where))),
      ),
    },
    notification: { create: jest.fn().mockResolvedValue({}) },
  };
  const service = new DemandsService(prisma);
  const res: any = await service.searchOffers(demand.id, demand.companyId, demand.dispatcherId);
  return res.offers.map((o: Offer) => o.id).sort();
}

/** Path A — auto-notification. Returns the ids of the offers a notification was created for. */
async function autoNotify(offers: Offer[], demand: Demand): Promise<string[]> {
  const notifiedOfferIds: string[] = [];
  const prisma: any = {
    dispatcherDemand: {
      findMany: jest.fn().mockResolvedValue([demand]),
      update: jest.fn().mockResolvedValue({}),
    },
    notification: {
      create: jest.fn(({ data }: any) => {
        notifiedOfferIds.push(data.offerId);
        return Promise.resolve({});
      }),
    },
  };
  const service = new DemandsService(prisma);
  for (const o of offers) {
    await service.checkNewOfferAgainstDemands(demand.companyId, o);
  }
  return notifiedOfferIds.sort();
}

/** Runs both paths and returns both results for comparison. */
async function bothPaths(offers: Offer[], over: Partial<Demand> = {}) {
  const demand = { ...demandBase, ...over };
  return {
    auto: await autoNotify(offers, demand),
    manual: await manualSearch(offers, demand),
  };
}

describe('Path equivalence: auto-notification vs manual search', () => {
  describe('offers with complete data — both paths must agree', () => {
    it('with no criteria both let everything through', async () => {
      const { auto, manual } = await bothPaths([offer('a'), offer('b'), offer('c')]);
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['a', 'b', 'c']);
    });

    it('country filter', async () => {
      const offers = [offer('pl', { pickupCountry: 'PL' }), offer('es', { pickupCountry: 'ES' })];
      const { auto, manual } = await bothPaths(offers, { preferredCountries: ['PL', 'CZ'] });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['pl']);
    });

    it('weight filter', async () => {
      const offers = [offer('lekka', { weightKg: 20000 }), offer('ciezka', { weightKg: 25000 })];
      const { auto, manual } = await bothPaths(offers, { maxWeight: 24 });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['lekka']);
    });

    it('ADR filter', async () => {
      const offers = [offer('adr', { isAdr: true }), offer('zwykla', { isAdr: false })];
      const { auto, manual } = await bothPaths(offers, { adrRequired: true });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['adr']);
    });

    it('temperature filter', async () => {
      const offers = [offer('frigo', { isFrigo: true }), offer('sucha', { isFrigo: false })];
      const { auto, manual } = await bothPaths(offers, { temperatureRequired: true });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['frigo']);
    });

    it('all criteria at once', async () => {
      const offers = [
        offer('ok', { pickupCountry: 'CZ', weightKg: 18000, isAdr: true, isFrigo: true }),
        offer('zly-kraj', { pickupCountry: 'ES', weightKg: 18000, isAdr: true, isFrigo: true }),
        offer('za-ciezka', { pickupCountry: 'CZ', weightKg: 30000, isAdr: true, isFrigo: true }),
        offer('bez-adr', { pickupCountry: 'CZ', weightKg: 18000, isAdr: false, isFrigo: true }),
      ];
      const { auto, manual } = await bothPaths(offers, {
        preferredCountries: ['PL', 'CZ'],
        maxWeight: 24,
        adrRequired: true,
        temperatureRequired: true,
      });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['ok']);
    });
  });

  describe('offers with missing data — both paths agree and keep the offer', () => {
    it('offer without weight, demand with a weight limit', async () => {
      const { auto, manual } = await bothPaths([offer('bez-masy', { weightKg: null })], { maxWeight: 24 });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['bez-masy']); // missing data rejects in neither path
    });

    it('offer with weight 0, demand with a weight limit', async () => {
      const { auto, manual } = await bothPaths([offer('masa-zero', { weightKg: 0 })], { maxWeight: 24 });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['masa-zero']); // 0 kg <= 24 t
    });

    it('offer without a pickup country, demand with a country list', async () => {
      const { auto, manual } = await bothPaths([offer('bez-kraju', { pickupCountry: null })], {
        preferredCountries: ['PL'],
      });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['bez-kraju']);
    });

    it('offer without an ADR flag, demand requiring ADR', async () => {
      const { auto, manual } = await bothPaths([offer('bez-flagi', { isAdr: null })], { adrRequired: true });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['bez-flagi']);
    });

    it('offer without a reefer flag, demand requiring a reefer', async () => {
      const { auto, manual } = await bothPaths([offer('bez-flagi', { isFrigo: null })], {
        temperatureRequired: true,
      });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['bez-flagi']);
    });

    it('mixed set: complete and incomplete offers together', async () => {
      const offers = [
        offer('pelna-ok', { weightKg: 18000 }),
        offer('pelna-za-ciezka', { weightKg: 30000 }),
        offer('bez-masy', { weightKg: null }),
        offer('masa-zero', { weightKg: 0 }),
      ];
      const { auto, manual } = await bothPaths(offers, { maxWeight: 24 });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['bez-masy', 'masa-zero', 'pelna-ok']); // only the offer that is really too heavy drops out
    });
  });

  describe('offer status range — both paths must take the same set', () => {
    const ALL_OFFER_STATUSES = [
      'NEW',
      'ASSIGNED',
      'ACCEPTED',
      'REJECTED',
      'EXPIRED',
      'IN_TRANSIT',
      'COMPLETED',
    ];

    it('only NEW and ASSIGNED qualify for matching', async () => {
      const offers = ALL_OFFER_STATUSES.map((s) => offer(s.toLowerCase(), { status: s }));
      const { auto, manual } = await bothPaths(offers);

      expect(auto).toEqual(manual);
      expect(auto).toEqual(['assigned', 'new']);
    });

    it.each(['ACCEPTED', 'REJECTED', 'EXPIRED', 'IN_TRANSIT', 'COMPLETED'])(
      'offer with status %s is matched in neither path',
      async (status) => {
        const { auto, manual } = await bothPaths([offer('x', { status })]);
        expect(auto).toEqual(manual);
        expect(auto).toEqual([]);
      },
    );

    it.each(['NEW', 'ASSIGNED'])('offer with status %s is matched in both paths', async (status) => {
      const { auto, manual } = await bothPaths([offer('x', { status })]);
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['x']);
    });

    it('offer without a status is left out in both paths', async () => {
      const { auto, manual } = await bothPaths([offer('bez-statusu', { status: null as any })]);
      expect(auto).toEqual(manual);
      expect(auto).toEqual([]);
    });

    it('the status range and the domain criteria apply together', async () => {
      const offers = [
        offer('new-ok', { status: 'NEW', weightKg: 18000 }),
        offer('new-za-ciezka', { status: 'NEW', weightKg: 30000 }),
        offer('completed-ok', { status: 'COMPLETED', weightKg: 18000 }),
      ];
      const { auto, manual } = await bothPaths(offers, { maxWeight: 24 });

      expect(auto).toEqual(manual);
      expect(auto).toEqual(['new-ok']);
    });
  });

  describe('zero and empty thresholds in the demand', () => {
    it('maxWeight = 0 works the same in both paths', async () => {
      const offers = [offer('lekka', { weightKg: 100 }), offer('ciezka', { weightKg: 30000 })];
      const { auto, manual } = await bothPaths(offers, { maxWeight: 0 });
      expect(auto).toEqual(manual);
      expect(auto).toEqual([]); // 0 t is a zero threshold, not a missing one
    });

    it('an empty country list filters in neither path', async () => {
      const offers = [offer('pl', { pickupCountry: 'PL' }), offer('es', { pickupCountry: 'ES' })];
      const { auto, manual } = await bothPaths(offers, { preferredCountries: [] });
      expect(auto).toEqual(manual);
      expect(auto).toEqual(['es', 'pl']);
    });
  });
});
