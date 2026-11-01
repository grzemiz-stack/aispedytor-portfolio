/**
 * Coordinates of the seed offers — one city → coordinates map (seed-cities.ts).
 *
 * Without coordinates LTL cannot compute an offer's detour: the offer is not
 * ranked and waits as `OFFER_AWAITING_LOCATION`, so it drops out of the demo.
 * This test reads seed.ts directly: a city added to an offer but not to the
 * map fails here, before the seed breaks in tools/demo-test.sh (which requires
 * every seed offer to have coordinates).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SEED_CITY_COORDS, cityCoords, withCoords } from '../../prisma/seed-cities';

const SEED = readFileSync(resolve(__dirname, '../../prisma/seed.ts'), 'utf8');
const seedCities = [
  ...SEED.matchAll(/(?:pickupCity|deliveryCity): '([^']+)'/g),
  ...SEED.matchAll(/\b(?:from|to): '([^']+)'/g),
].map(m => m[1]);

describe('seed offer coordinates', () => {
  it('the seed source mentions cities at all (the pattern still matches)', () => {
    expect(new Set(seedCities).size).toBeGreaterThan(40);
  });

  it.each([...new Set(seedCities)].sort())('%s has coordinates in the map', city => {
    expect(SEED_CITY_COORDS[city]).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
  });

  it('every coordinate is a plausible European point', () => {
    for (const [city, c] of Object.entries(SEED_CITY_COORDS)) {
      expect([city, c.lat >= 35 && c.lat <= 72 && c.lng >= -11 && c.lng <= 32]).toEqual([city, true]);
    }
  });

  it('exonyms point at the same place as the local names', () => {
    for (const [pl, local] of [['Paryż', 'Paris'], ['Mediolan', 'Milano'], ['Praga', 'Praha'], ['Wiedeń', 'Wien'], ['Kopenhaga', 'Copenhagen']]) {
      expect(cityCoords(pl)).toEqual(cityCoords(local));
    }
  });

  it('withCoords fills all four fields; an unknown city stops the seed', () => {
    expect(withCoords({ pickupCity: 'Poznań', deliveryCity: 'Berlin', x: 1 })).toEqual({
      pickupCity: 'Poznań', deliveryCity: 'Berlin', x: 1,
      pickupLat: 52.4064, pickupLng: 16.9252, deliveryLat: 52.52, deliveryLng: 13.405,
    });
    expect(() => withCoords({ pickupCity: 'Atlantyda', deliveryCity: 'Berlin' })).toThrow(/Atlantyda/);
  });
});
