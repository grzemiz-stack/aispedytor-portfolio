import { BATCH_SIZE, OfferGeocodingTask } from './offer-geocoding.task';
import type { GeocodeResult } from './geocoding.service';

const NOW = new Date('2026-09-29T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const offer = (id: string, over: Record<string, any> = {}) => ({
  id,
  pickupCity: 'Berlin',
  pickupCountry: 'DE',
  pickupLat: null,
  pickupLng: null,
  deliveryCity: 'Poznań',
  deliveryCountry: 'PL',
  deliveryLat: null,
  deliveryLng: null,
  ...over,
});

const found = (lat: number, lng: number): GeocodeResult => ({ status: 'found', coords: { lat, lng } });

function setup(offers: any[], answers: Record<string, GeocodeResult>) {
  const prisma: any = {
    offer: {
      findMany: jest.fn().mockResolvedValue(offers),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  const geocoding: any = {
    now: () => NOW.getTime(),
    lookup: jest.fn(async (q: string) => answers[q] ?? { status: 'not_found' }),
  };
  return { task: new OfferGeocodingTask(prisma, geocoding), prisma, geocoding };
}

describe('OfferGeocodingTask', () => {
  it('fills both ends and marks the offer as checked', async () => {
    const { task, prisma } = setup([offer('o1')], {
      'Berlin, DE': found(52.52, 13.405),
      'Poznań, PL': found(52.4064, 16.9252),
    });
    await expect(task.fillMissingCoordinates()).resolves.toEqual({ checked: 1, filled: 1, aborted: false });
    expect(prisma.offer.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: {
        pickupLat: 52.52,
        pickupLng: 13.405,
        deliveryLat: 52.4064,
        deliveryLng: 16.9252,
        coordsCheckedAt: NOW,
      },
    });
  });

  it('an address unknown to Nominatim still marks the offer as checked', async () => {
    const { task, prisma } = setup([offer('o1')], {});
    await expect(task.fillMissingCoordinates()).resolves.toEqual({ checked: 1, filled: 0, aborted: false });
    expect(prisma.offer.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { coordsCheckedAt: NOW } });
  });

  it('asks only for the missing end; a coordinate 0 is present, not missing', async () => {
    const { task, geocoding } = setup(
      [offer('o1', { pickupLat: 51.4779, pickupLng: 0 })],
      { 'Poznań, PL': found(52.4064, 16.9252) },
    );
    await task.fillMissingCoordinates();
    expect(geocoding.lookup).toHaveBeenCalledTimes(1);
    expect(geocoding.lookup).toHaveBeenCalledWith('Poznań, PL');
  });

  it('a Nominatim error stops the run and leaves the offer unchecked', async () => {
    const { task, prisma, geocoding } = setup([offer('o1'), offer('o2')], {
      'Berlin, DE': { status: 'error' },
    });
    await expect(task.fillMissingCoordinates()).resolves.toEqual({ checked: 0, filled: 0, aborted: true });
    expect(prisma.offer.update).not.toHaveBeenCalled();
    // A service that is not working is not asked again in this run.
    expect(geocoding.lookup).toHaveBeenCalledTimes(1);
  });

  it('selects only unchecked offers or ones checked before the miss TTL — unknown addresses cannot starve the queue', async () => {
    const { task, prisma } = setup([], {});
    await task.fillMissingCoordinates();
    const arg = prisma.offer.findMany.mock.calls[0][0];
    expect(arg.take).toBe(BATCH_SIZE);
    expect(arg.where.status).toBe('NEW');
    expect(arg.where.AND).toEqual([
      { OR: [{ coordsCheckedAt: null }, { coordsCheckedAt: { lt: new Date(NOW.getTime() - 7 * DAY_MS) } }] },
    ]);
  });

  it('an overlapping scheduled run is skipped', async () => {
    const { task, prisma } = setup([offer('o1')], {});
    let release!: () => void;
    prisma.offer.findMany.mockImplementationOnce(
      () => new Promise(r => (release = () => r([offer('o1')]))),
    );
    const first = task.run();
    await expect(task.run()).resolves.toBeNull();
    release();
    await expect(first).resolves.toMatchObject({ checked: 1 });
    // Once the first run has finished, a new run starts again.
    await expect(task.run()).resolves.not.toBeNull();
  });
});
