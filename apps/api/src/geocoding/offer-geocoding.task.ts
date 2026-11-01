import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { GeocodingService, NOT_FOUND_TTL_DAYS, type GeocodeResult } from './geocoding.service';

/**
 * How many offers one run fills in. At 1 request/s and two points per offer,
 * 20 offers take at most about 40 s — well inside the 5-minute schedule.
 */
export const BATCH_SIZE = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GeocodingRunSummary {
  checked: number;
  filled: number;
  /** The run was stopped by a Nominatim error — the rest waits for the next run. */
  aborted: boolean;
}

/**
 * Fills in offer coordinates in the background, on a schedule. The LTL search
 * reads the offers' stored coordinates and does not wait for Nominatim for them.
 */
@Injectable()
export class OfferGeocodingTask {
  private readonly logger = new Logger(OfferGeocodingTask.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
  ) {}

  @Cron('*/5 * * * *')
  async run(): Promise<GeocodingRunSummary | null> {
    // A run longer than the schedule interval must not overlap with the next
    // one — two runs at once would pick the same offers and send Nominatim the
    // same requests twice.
    if (this.running) return null;
    this.running = true;
    try {
      return await this.fillMissingCoordinates();
    } finally {
      this.running = false;
    }
  }

  async fillMissingCoordinates(): Promise<GeocodingRunSummary> {
    const now = new Date(this.geocoding.now());
    const recheckBefore = new Date(now.getTime() - NOT_FOUND_TTL_DAYS * DAY_MS);

    const offers = await this.prisma.offer.findMany({
      where: {
        status: 'NEW',
        OR: [{ pickupLat: null }, { pickupLng: null }, { deliveryLat: null }, { deliveryLng: null }],
        // An offer that was already checked comes back only after the miss TTL.
        // Without this, addresses unknown to Nominatim would fill the batch in
        // every run and the other offers would never get coordinates.
        AND: [{ OR: [{ coordsCheckedAt: null }, { coordsCheckedAt: { lt: recheckBefore } }] }],
      },
      orderBy: { createdAt: 'desc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        pickupCity: true,
        pickupCountry: true,
        pickupLat: true,
        pickupLng: true,
        deliveryCity: true,
        deliveryCountry: true,
        deliveryLat: true,
        deliveryLng: true,
      },
    });

    let checked = 0;
    let filled = 0;
    for (const offer of offers) {
      const data: Record<string, number | Date> = {};

      if (offer.pickupLat == null || offer.pickupLng == null) {
        const r = await this.geocoding.lookup(address(offer.pickupCity, offer.pickupCountry));
        if (r.status === 'error') return this.abort(checked, filled);
        if (r.status === 'found') {
          data.pickupLat = r.coords.lat;
          data.pickupLng = r.coords.lng;
        }
      }
      if (offer.deliveryLat == null || offer.deliveryLng == null) {
        const r: GeocodeResult = await this.geocoding.lookup(
          address(offer.deliveryCity, offer.deliveryCountry),
        );
        if (r.status === 'error') return this.abort(checked, filled);
        if (r.status === 'found') {
          data.deliveryLat = r.coords.lat;
          data.deliveryLng = r.coords.lng;
        }
      }

      const gotCoords = Object.keys(data).length > 0;
      data.coordsCheckedAt = now;
      await this.prisma.offer.update({ where: { id: offer.id }, data });
      checked++;
      if (gotCoords) filled++;
    }

    if (offers.length > 0) {
      this.logger.log(`Offer geocoding: checked ${checked}, filled ${filled}`);
    }
    return { checked, filled, aborted: false };
  }

  /**
   * A Nominatim error (network, any non-2xx status such as 429 or 5xx,
   * unreadable coordinates) stops the run. The offer is NOT marked as
   * checked — it comes back in the next run. More requests to a service that
   * is not working would only add to its load.
   */
  private abort(checked: number, filled: number): GeocodingRunSummary {
    this.logger.warn(
      `Offer geocoding stopped by a Nominatim error after ${checked} offers — the rest in the next run`,
    );
    return { checked, filled, aborted: true };
  }
}

function address(city: string, country?: string | null): string {
  return country ? `${city}, ${country}` : city;
}
