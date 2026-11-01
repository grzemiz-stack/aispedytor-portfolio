/**
 * Contract every TollProvider implementation must pass.
 *
 * Usage, in a `*.spec.ts` file next to your implementation's tests:
 *
 *   import { runTollProviderContract } from '../contract/toll-provider.contract';
 *   runTollProviderContract('MyTollProvider', {
 *     make: () => new MyTollProvider(config),
 *     failing: () => new MyTollProvider({ ...config, apiKey: 'invalid' }),
 *   });
 *
 * `make` returns a working provider; `failing` returns one whose calls fail
 * (wrong credentials, unreachable host…), so the error shape is checked too.
 * Run: `npx jest test/contract` (or the whole suite: `npm test`).
 */
import { TollProviderError, type TollProvider, type TollRequest } from '../../src/tolls/toll-provider';

/** Poznań → Berlin → Paris: three countries with distance charges for trucks. */
export const CONTRACT_REQUEST: TollRequest = {
  route: {
    points: [
      { lat: 52.4064, lng: 16.9252 },
      { lat: 52.52, lng: 13.405 },
      { lat: 48.8566, lng: 2.3522 },
    ],
    polyline: '52.406400,16.925200;52.520000,13.405000;48.856600,2.352200',
    distanceKm: 1320,
    countries: [
      { countryCode: 'PL', distanceKm: 160 },
      { countryCode: 'DE', distanceKm: 760 },
      { countryCode: 'FR', distanceKm: 400 },
    ],
  },
  vehicle: { axleClass: '5+', emissionClass: 'EURO_VI', grossWeightTonnes: 40 },
};

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export function runTollProviderContract(
  name: string,
  impl: { make: () => TollProvider; failing: () => TollProvider; request?: TollRequest },
) {
  const request = impl.request ?? CONTRACT_REQUEST;

  describe(`TollProvider contract — ${name}`, () => {
    it('returns a quote with a non-empty source', async () => {
      const q = await impl.make().quote(clone(request));
      expect(typeof q.source).toBe('string');
      expect(q.source.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(q.items)).toBe(true);
    });

    it('every item: country from the request, amount finite and ≥ 0, ISO 4217 currency', async () => {
      const q = await impl.make().quote(clone(request));
      const allowed = new Set(request.route.countries.map(c => c.countryCode));
      for (const item of q.items) {
        expect(item.countryCode).toMatch(/^[A-Z]{2}$/);
        expect(allowed.has(item.countryCode)).toBe(true);
        expect(Number.isFinite(item.amount)).toBe(true);
        expect(item.amount).toBeGreaterThanOrEqual(0);
        expect(item.currency).toMatch(/^[A-Z]{3}$/);
        if (item.system !== undefined) expect(typeof item.system).toBe('string');
      }
    });

    it('at most one item per country', async () => {
      const q = await impl.make().quote(clone(request));
      const codes = q.items.map(i => i.countryCode);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('does not modify the request', async () => {
      const frozen = deepFreeze(clone(request));
      await expect(impl.make().quote(frozen)).resolves.toBeDefined();
      expect(frozen).toEqual(request);
    });

    it('a route with no countries is charged nothing (no invented toll)', async () => {
      const empty: TollRequest = { ...clone(request), route: { ...clone(request.route), countries: [], distanceKm: 0 } };
      expect((await impl.make().quote(empty)).items).toEqual([]);
    });

    it('a failure surfaces as TollProviderError with a non-empty reason — never a made-up quote', async () => {
      const result = impl.failing().quote(clone(request));
      await expect(result).rejects.toBeInstanceOf(TollProviderError);
      await result.catch((e: TollProviderError) => expect(e.reason.trim().length).toBeGreaterThan(0));
    });
  });
}
