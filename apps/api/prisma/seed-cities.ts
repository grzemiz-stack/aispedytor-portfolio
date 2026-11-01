/**
 * Coordinates of the cities used by the seed — one map for all offers.
 *
 * In LTL an offer without coordinates is not ranked: it waits in
 * `awaitingLocation` until the geocoding task fills them in
 * (docs/decisions.md §2). So every seed offer gets coordinates up front —
 * the demo depends neither on the network nor on the background geocoding
 * task.
 *
 * City centres, accurate to about 100 m. Polish exonyms (Kopenhaga,
 * Mediolan, Paryż, Praga, Wiedeń) point to the same place as the local
 * names. "Frankfurt" = Frankfurt am Main; Frankfurt (Oder) is in the demo
 * scenario (seed-demo-ltl.ts) with its own coordinates.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export const SEED_CITY_COORDS: Readonly<Record<string, LatLng>> = {
  // Poland
  'Warszawa': { lat: 52.2297, lng: 21.0122 },
  'Poznań': { lat: 52.4064, lng: 16.9252 },
  'Kraków': { lat: 50.0647, lng: 19.9450 },
  'Wrocław': { lat: 51.1079, lng: 17.0385 },
  'Gdańsk': { lat: 54.3520, lng: 18.6466 },
  'Łódź': { lat: 51.7592, lng: 19.4560 },
  'Katowice': { lat: 50.2649, lng: 19.0238 },
  'Szczecin': { lat: 53.4285, lng: 14.5528 },
  'Rzeszów': { lat: 50.0412, lng: 21.9991 },
  // Germany
  'Berlin': { lat: 52.5200, lng: 13.4050 },
  'Hamburg': { lat: 53.5511, lng: 9.9937 },
  'München': { lat: 48.1351, lng: 11.5820 },
  'Frankfurt': { lat: 50.1109, lng: 8.6821 },
  'Stuttgart': { lat: 48.7758, lng: 9.1829 },
  'Hannover': { lat: 52.3759, lng: 9.7320 },
  'Dresden': { lat: 51.0504, lng: 13.7373 },
  'Nürnberg': { lat: 49.4521, lng: 11.0767 },
  'Köln': { lat: 50.9375, lng: 6.9603 },
  // Benelux
  'Amsterdam': { lat: 52.3676, lng: 4.9041 },
  'Rotterdam': { lat: 51.9244, lng: 4.4777 },
  'Eindhoven': { lat: 51.4416, lng: 5.4697 },
  'Antwerpen': { lat: 51.2194, lng: 4.4025 },
  'Bruxelles': { lat: 50.8503, lng: 4.3517 },
  // France
  'Paris': { lat: 48.8566, lng: 2.3522 },
  'Paryż': { lat: 48.8566, lng: 2.3522 },
  'Lyon': { lat: 45.7640, lng: 4.8357 },
  'Marseille': { lat: 43.2965, lng: 5.3698 },
  // Italy
  'Milano': { lat: 45.4642, lng: 9.1900 },
  'Mediolan': { lat: 45.4642, lng: 9.1900 },
  'Roma': { lat: 41.9028, lng: 12.4964 },
  'Verona': { lat: 45.4384, lng: 10.9916 },
  // Spain
  'Barcelona': { lat: 41.3874, lng: 2.1686 },
  'Madrid': { lat: 40.4168, lng: -3.7038 },
  // Austria, Czechia, Slovakia, Hungary
  'Wien': { lat: 48.2082, lng: 16.3738 },
  'Wiedeń': { lat: 48.2082, lng: 16.3738 },
  'Graz': { lat: 47.0707, lng: 15.4395 },
  'Praha': { lat: 50.0755, lng: 14.4378 },
  'Praga': { lat: 50.0755, lng: 14.4378 },
  'Brno': { lat: 49.1951, lng: 16.6068 },
  'Bratislava': { lat: 48.1486, lng: 17.1077 },
  'Budapest': { lat: 47.4979, lng: 19.0402 },
  // Scandinavia
  'Copenhagen': { lat: 55.6761, lng: 12.5683 },
  'Kopenhaga': { lat: 55.6761, lng: 12.5683 },
  'Stockholm': { lat: 59.3293, lng: 18.0686 },
  'Malmö': { lat: 55.6050, lng: 13.0038 },
};

/** Coordinates of a city from the map; an unknown city is a seed error, not an offer without coordinates. */
export function cityCoords(city: string): LatLng {
  const c = SEED_CITY_COORDS[city];
  if (!c) throw new Error(`seed: no coordinates for "${city}" — add the city to prisma/seed-cities.ts`);
  return c;
}

/** The offer with pickup and delivery coordinates added (from the map). */
export function withCoords<T extends { pickupCity: string; deliveryCity: string }>(offer: T) {
  const p = cityCoords(offer.pickupCity);
  const d = cityCoords(offer.deliveryCity);
  return { ...offer, pickupLat: p.lat, pickupLng: p.lng, deliveryLat: d.lat, deliveryLng: d.lng };
}

/** Only the coordinates from the map — for `update` on a repeated seed. */
export function coordsOnly(offer: { pickupCity: string; deliveryCity: string }) {
  const { pickupLat, pickupLng, deliveryLat, deliveryLng } = withCoords(offer);
  return { pickupLat, pickupLng, deliveryLat, deliveryLng };
}

/**
 * Repeated seed on an existing database: overwrites the coordinates of seed
 * offers (matched by `externalId` prefix) with the values from the map. The
 * blocks that create these offers are skipped when data already exists —
 * without this, a database seeded before the city map would keep offers
 * without coordinates (which LTL does not rank).
 */
export async function refreshSeedCoords(
  prisma: {
    offer: {
      findMany(args: object): Promise<{ id: string; pickupCity: string; deliveryCity: string }[]>;
      update(args: object): Promise<unknown>;
    };
  },
  companyId: string,
  prefixes: string[],
): Promise<number> {
  const offers = await prisma.offer.findMany({
    where: { companyId, OR: prefixes.map(p => ({ externalId: { startsWith: p } })) },
    select: { id: true, pickupCity: true, deliveryCity: true },
  });
  for (const o of offers) {
    await prisma.offer.update({ where: { id: o.id }, data: coordsOnly(o) });
  }
  return offers.length;
}
