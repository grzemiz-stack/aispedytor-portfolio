/**
 * Km per country from the route geometry — by the driven distance, not by the
 * number of points, with each border found by bisection (decisions.md §5a).
 *
 * Before: `detectCountries` sampled every N-th POINT of the geometry and gave
 * each sample an equal share — a country with dense geometry (towns, bends)
 * got too many km, a sparse one (motorways) too few. Warsaw → Madrid: ES
 * 810 km instead of about 470.
 * Now: probes at the start, the end and the middle of every ~50 km piece of
 * the DRIVEN road; between neighbouring probes in different countries the
 * stretch is halved down to ≤ 6.25 km (border ±~3 km). A narrow strip of a
 * country hit by a bisection probe (or by the start/end probe) gets its km —
 * with piece middles only, 14 km of Italy on Trieste → Rijeka got 0 km.
 */
import { RouteCalculatorService } from '../../src/route-planner/osrm-calculator.service';

// Lines along the equator (1° of longitude ≈ 111.2 km); the country depends on the longitude only.
const KM_PER_DEG = 111.195;
type Stretch = { code: string; km: number; points: number };

/** A line of consecutive country stretches; `points` geometry points per stretch (the density). */
function line(stretches: Stretch[]) {
  const coords: number[][] = [];
  const ends: { code: string; lonEnd: number }[] = [];
  let lon = 0;
  for (const s of stretches) {
    const width = s.km / KM_PER_DEG;
    for (let i = 0; i < s.points; i++) coords.push([lon + (width * i) / s.points, 0]);
    lon += width;
    ends.push({ code: s.code, lonEnd: lon });
  }
  coords.push([lon, 0]);
  const countryAt = (x: number) => (ends.find((e) => x < e.lonEnd) ?? ends[ends.length - 1]).code;
  return { geometry: { type: 'LineString' as const, coordinates: coords }, countryAt, totalKm: stretches.reduce((s, c) => s + c.km, 0) };
}

async function detect(stretches: Stretch[]) {
  const { geometry, countryAt, totalKm } = line(stretches);
  const svc: any = new RouteCalculatorService();
  const calls: number[][] = [];
  svc.reverseGeocodeCountry = async (lat: number, lon: number) => {
    calls.push([lat, lon]);
    return countryAt(lon);
  };
  const out: { code: string; distanceKm: number }[] = await svc.detectCountries(geometry, totalKm);
  return { km: Object.fromEntries(out.map((c) => [c.code, c.distanceKm])), calls, total: out.reduce((s, c) => s + c.distanceKm, 0) };
}

// Country A dense (600 points over 60 km), country B sparse (24 points over 240 km).
const DENSE_SPARSE: Stretch[] = [{ code: 'aa', km: 60, points: 600 }, { code: 'bb', km: 240, points: 24 }];

it('km follow the driven distance, not the number of points: A = 60, B = 240 (border ±6 km)', async () => {
  const { km, total } = await detect(DENSE_SPARSE);
  expect(Math.abs(km.AA - 60)).toBeLessThanOrEqual(6);
  expect(Math.abs(km.BB - 240)).toBeLessThanOrEqual(6);
  expect(total).toBe(300);
});

// 394 km = 8 pieces of 49.25 km; their middles in A (172 km) and B (222 km), the 14 km strip X lies between them.
// Bisection hits X once near its left border, once near its right one — the other border is then far and must be searched too.
it.each([
  ['found near its left border', 184, 196],
  ['found near its right border', 196, 184],
])('a narrow strip between two long countries gets its km (14 km, %s; borders ±6 km)', async (_n, aKm, bKm) => {
  const { km, total } = await detect([
    { code: 'aa', km: aKm, points: aKm }, { code: 'xx', km: 14, points: 14 }, { code: 'bb', km: bKm, points: bKm },
  ]);
  expect(km.XX).toBeGreaterThan(0);
  expect(Math.abs(km.XX - 14)).toBeLessThanOrEqual(6);
  expect(Math.abs(km.AA - aKm)).toBeLessThanOrEqual(6);
  expect(Math.abs(km.BB - bKm)).toBeLessThanOrEqual(6);
  expect(total).toBe(394);
});

it('the border is put in the middle of the last stretch: ±~3 km (half of 6.25 km), not anywhere in it', async () => {
  // Border at 50.5 km: the last bisection stretch is 50–56.25 km; its middle gives 53.1 km, the whole stretch to one side 50 or 56.25.
  const { km } = await detect([{ code: 'aa', km: 50.5, points: 505 }, { code: 'bb', km: 249.5, points: 25 }]);
  expect(Math.abs(km.AA - 50.5)).toBeLessThanOrEqual(3.5);
});

it('a narrow strip at the start of the route gets its km (like 14 km of Italy on Trieste → Rijeka)', async () => {
  // 75 km = 2 pieces of 37.5 km; their middles (18.75 and 56.25 km) are in A and B, the strip X is the first 14 km.
  const { km, total } = await detect([
    { code: 'xx', km: 14, points: 14 }, { code: 'aa', km: 30, points: 30 }, { code: 'bb', km: 31, points: 31 },
  ]);
  expect(Math.abs(km.XX - 14)).toBeLessThanOrEqual(6);
  expect(Math.abs(km.AA - 30)).toBeLessThanOrEqual(6);
  expect(Math.abs(km.BB - 31)).toBeLessThanOrEqual(6);
  expect(total).toBe(75);
});

it('Nominatim requests: one per ~50 km + start and end; a border adds at most 3', async () => {
  const oneCountry = await detect([{ code: 'aa', km: 300, points: 300 }]);
  expect(oneCountry.calls.length).toBe(Math.ceil(300 / 50) + 2);
  const oneBorder = await detect(DENSE_SPARSE);
  expect(oneBorder.calls.length).toBeLessThanOrEqual(Math.ceil(300 / 50) + 2 + 3);
});

it.each([
  ['the start of the route', 0],
  ['a piece in the middle', 2],
  ['a bisection probe at the border', 8],
])('a probe whose country is unknown (%s): the neighbours share its stretch (the total stays the route distance)', async (_n, unknown) => {
  const { geometry, countryAt } = line(DENSE_SPARSE);
  const svc: any = new RouteCalculatorService();
  let n = 0;
  svc.reverseGeocodeCountry = async (_lat: number, lon: number) => (n++ === unknown ? null : countryAt(lon));
  const out: { code: string; distanceKm: number }[] = await svc.detectCountries(geometry, 300);
  expect(out.reduce((s, c) => s + c.distanceKm, 0)).toBe(300);
  expect(out.map((c) => c.code).sort()).toEqual(['AA', 'BB']);
});
