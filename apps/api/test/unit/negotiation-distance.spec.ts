/**
 * NegotiationService — offer distance estimated from coordinates.
 *
 * Characterization test. `estimateDistance` runs when an offer has no
 * `distanceKm` (analysis and simulator); this pins its numbers.
 *
 * The method is private; the test calls it directly because the public entry
 * points need the whole database and the question is about this one number.
 */
import { NegotiationService } from '../../src/negotiation/negotiation.service';

const POZNAN = { lat: 52.4064, lng: 16.9252 };
const BERLIN = { lat: 52.52, lng: 13.405 };

const estimate = (offer: Record<string, any>): number | null =>
  (new NegotiationService({} as any) as any).estimateDistance(offer);

const berlinPoznan = {
  pickupLat: BERLIN.lat,
  pickupLng: BERLIN.lng,
  deliveryLat: POZNAN.lat,
  deliveryLng: POZNAN.lng,
};

describe('negotiation distance estimate', () => {
  it('straight line × 1.3, rounded: Berlin → Poznań = 310 km', () => {
    expect(estimate(berlinPoznan)).toBe(310);
  });

  it('no coordinates → null', () => {
    expect(estimate({ pickupLat: null, pickupLng: null, deliveryLat: null, deliveryLng: null })).toBeNull();
  });

  it('coordinate equal to 0 is a coordinate: Berlin → (52.4064, 0) = 1179 km', () => {
    expect(estimate({ ...berlinPoznan, deliveryLng: 0 })).toBe(1179);
  });
});
