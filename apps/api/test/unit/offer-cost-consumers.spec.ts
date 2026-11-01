/**
 * Negotiation and the route planner compute the cost only through
 * common/offer-cost.ts.
 *
 * The "Niska marża" argument, the simulation and the planner used three
 * different cost bases (fuel from constants 32 l/100 km × 6.50 PLN, "other"
 * 0.5 PLN/km, fuel fields in the planner request). Now: the company cost per
 * km × km + toll, and without a cost — an explicit reason. The last test keeps
 * the constants from coming back.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NegotiationService } from '../../src/negotiation/negotiation.service';
import { RoutePlannerService } from '../../src/route-planner/route-planner.service';
import { FixedRateTollProvider } from '../fakes/fixed-rate-toll-provider';

const OFFER = {
  id: 'o1', companyId: 'c', pickupCity: 'Poznań', deliveryCity: 'Berlin', pickupCountry: 'PL', deliveryCountry: 'DE',
  distanceKm: 800, tollCostEstimate: null, contractorId: null, pickupDate: new Date('2030-10-10'), cargoType: 'x',
  isAdr: false, weightKg: 1000, pricePerKm: null, price: 4000, currency: 'PLN',
};
const ROUTE = { distanceKm: 812, tollTotalEur: 118.5, tollTotalPln: 0, tollBreakdown: [], tollUnresolved: [], calculatedAt: new Date('2030-09-08'), tollNeedsVerification: false };

function negotiation(opts: { offer?: object; route?: object | null; costPerKm?: number | null } = {}) {
  const offer = { ...OFFER, ...opts.offer };
  const svc = new NegotiationService({
    offer: { findFirst: async () => offer, findMany: async () => [], count: async () => 0, aggregate: async () => ({ _avg: {} }) },
    company: { findUnique: async () => ({ costPerKm: opts.costPerKm === undefined ? 4.2 : opts.costPerKm, costCurrency: 'PLN' }) },
    routeCalculation: { findFirst: async () => (opts.route === undefined ? ROUTE : opts.route) },
    contractor: { findFirst: async () => null },
  } as any);
  (svc as any).getPriceSuggestion = async () => ({ avgPrice: 4000, optimalPrice: 4000, minPrice: 3800, maxPrice: 4200, medianPrice: 4000, confidence: 0, sampleSize: 0, percentiles: { p25: 0, p50: 0, p75: 0 } });
  return svc;
}
const costArg = async (svc: NegotiationService) => (await svc.analyzeOffer('o1', 'c')).arguments.find((a: any) => a.type === 'cost') as any;

describe('the margin argument', () => {
  it('a route: cost = 812 km × 4,20 PLN + 118,50 EUR toll = 3925,62 PLN → margin 1,9 %, the parts and the source named', async () => {
    const a = await costArg(negotiation());
    expect(a.title).toBe('Niska marża');
    expect(a.text).toMatch(/^Koszt oferty to 3\s?926 PLN \(stawka 4,2 PLN\/km × 812 km = 3\s?410 PLN, myto: 515 PLN\)\./);
    expect(a.text).toMatch(/marza wynosi jedynie 1\.9%/);
    expect(a.text).toMatch(/Km i myto z trasy policzonej w planerze \(2030-09-08\)/);
  });

  it('a manual toll goes before the route toll and is named', async () => {
    const a = await costArg(negotiation({ offer: { tollCostEstimate: 200 } }));
    expect(a.text).toMatch(/myto: 200 PLN/);
    expect(a.text).toMatch(/Myto pochodzi z Twojej recznej korekty/);
  });

  it('no company rate: "cost unknown" with the reason, no margin', async () => {
    const a = await costArg(negotiation({ costPerKm: null }));
    expect([a.title, a.text]).toEqual(['Koszt oferty nieznany', 'Firma nie ma ustawionego kosztu kilometra — administrator ustawia go w ustawieniach firmy. Marza nie zostala oszacowana.']);
  });

  it('no distance at all: "cost unknown" — not an assumed distance', async () => {
    const a = await costArg(negotiation({ route: null, offer: { distanceKm: null, pickupLat: null, pickupLng: null, deliveryLat: null, deliveryLng: null } }));
    expect(a.title).toBe('Koszt oferty nieznany');
    expect(a.text).toMatch(/nie ma dystansu/);
  });

  it('a good margin with a known toll: no cost argument', async () => {
    expect(await costArg(negotiation({ offer: { price: 9000 } }))).toBeUndefined();
  });
});

describe('the planner and the company rate', () => {
  const route = (km: number, min: number, cc: string) => ({ distance: km * 1000, duration: min * 60, polyline: '', sections: [], countries: [{ countryCode: cc, distanceKm: km }] });
  async function plan(costPerKm: number | null, routes: any[], provider: any = null) {
    const svc = new RoutePlannerService({ calculateRoute: async () => routes } as any, { get: jest.fn(), set: jest.fn() } as any, {
      company: { findUnique: async () => ({ costPerKm, costCurrency: 'PLN' }) },
    } as any, provider);
    return svc.calculateRoute({ origin: { lat: 52, lng: 16 }, destination: { lat: 52, lng: 13 }, vehicle: { axleCount: 5 } } as any, 'c');
  }

  it('no rate: no cost, sorted by km, no "Najtańsza", the recommendation says why', async () => {
    const r = await plan(null, [route(900, 500, 'PL'), route(800, 600, 'PL')]);
    expect(r.routes.map((x: any) => [x.distanceKm, x.label, x.costs.totalCostPLN])).toEqual([[800, 'Najkrótsza', null], [900, 'Najszybsza', null]]);
    expect(r.recommendation.reason).toMatch(/koszt nieznany: firma nie ma kosztu kilometra/);
  });

  it('with a rate: sorted by cost, the cheapest first', async () => {
    const r = await plan(4.2, [route(900, 500, 'PL'), route(800, 600, 'PL')]);
    expect(r.routes.map((x: any) => [x.distanceKm, x.label.startsWith('Najtańsza')])).toEqual([[800, true], [900, false]]);
  });

  it('with a rate the cheapest can be the longer route (the shorter one has dearer tolls)', async () => {
    // 800 km DE: 772.80 EUR + 160 EUR toll = 932.80 EUR; 830 km PL: 801.78 EUR + 332 PLN (76.36 EUR) = 878.14 EUR.
    const r = await plan(4.2, [route(800, 500, 'DE'), route(830, 520, 'PL')], new FixedRateTollProvider());
    expect(r.routes.map((x: any) => [x.distanceKm, x.costs.totalCostEUR, x.label.startsWith('Najtańsza')])).toEqual([[830, 878.14, true], [800, 932.8, false]]);
  });
});

it('no cost constants are left in negotiation and the planner (fuel, "other" per km)', () => {
  const src = (f: string) => readFileSync(resolve(__dirname, '../../src', f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const f of ['negotiation/negotiation.service.ts', 'route-planner/route-planner.service.ts', 'route-planner/dto/calculate-route.dto.ts']) {
    expect([f, src(f).match(/DEFAULT_FUEL|fuelConsumption|fuelPrice|calculateFuelCost|\* 0\.5\b|\|\| 500\b/g)]).toEqual([f, null]);
  }
});
