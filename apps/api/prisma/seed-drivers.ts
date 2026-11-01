/**
 * Demo drivers for fleet planning (src/fleet-planning) — definitions only,
 * no database writes, so a test can check them against the rules engine.
 *
 * Anchored to the fixed week (UTC) of the seed clock, so the demo looks the
 * same whatever day it is seeded:
 *   1 — ready since Monday 06:00 after a regular weekly rest at home (MEGA tractor);
 *   2 — after a reduced weekly rest abroad, compensation owed, with the list
 *       of recent weekly rests (reefer tractor);
 *   3 — on leave until next Monday 06:00, no vehicle;
 *   4 — no status yet (availability answers DRIVER_STATUS_MISSING).
 */
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MONDAY_EPOCH = Date.UTC(1970, 0, 5);

/** Monday 00:00 UTC of the fixed week containing `now`. */
export function weekStartOf(now: Date): Date {
  const w = Math.floor((now.getTime() - MONDAY_EPOCH) / (7 * DAY));
  return new Date(MONDAY_EPOCH + w * 7 * DAY);
}

export interface SeedDriver {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  homeCity: string;
  homeCountry: string;
  /** Assigned when the vehicle is free. */
  vehicleId: string | null;
}

export const SEED_DRIVERS: SeedDriver[] = [
  { id: 'seed-driver-1', firstName: 'Marek', lastName: 'Wiśniewski', phone: '+48 603 100 201', homeCity: 'Poznań', homeCountry: 'PL', vehicleId: 'seed-vehicle-mega2' },
  { id: 'seed-driver-2', firstName: 'Tomasz', lastName: 'Lewandowski', phone: '+48 603 100 202', homeCity: 'Konin', homeCountry: 'PL', vehicleId: 'seed-vehicle-reefer' },
  { id: 'seed-driver-3', firstName: 'Katarzyna', lastName: 'Dąbrowska', phone: '+48 603 100 203', homeCity: 'Leszno', homeCountry: 'PL', vehicleId: null },
  { id: 'seed-driver-4', firstName: 'Paweł', lastName: 'Kamiński', phone: '+48 603 100 204', homeCity: 'Gniezno', homeCountry: 'PL', vehicleId: null },
];

/** The DriverStatus rows (one per driver with a status); `id` is fixed, so each seed refreshes them. */
export function seedDriverStatuses(now: Date) {
  const monday = weekStartOf(now).getTime();
  const at = (ms: number) => new Date(ms);
  const restEnd = at(monday + 6 * 60 * MINUTE);
  const previousRestEnd = at(restEnd.getTime() - 7 * DAY);
  const common = {
    asOf: restEnd,
    weeklyRestEndedAt: restEnd,
    drivingThisWeekMinutes: 0,
    extendedDrivingDaysUsed: 0,
    reducedDailyRestsUsed: 0,
    driverChoseToStayAway: false,
    // Resting at the moment of the status (explicit — unknown would be the worst case).
    onDuty: false,
  };
  return [
    {
      ...common,
      id: 'seed-driver-status-1',
      driverId: 'seed-driver-1',
      weeklyRestType: 'REGULAR' as const,
      weeklyRestAbroad: false,
      weeklyRestAtHome: true,
      recentWeeklyRests: null,
      drivingLastWeekMinutes: 45 * 60,
      compensationOwedMinutes: 0,
      compensationDueBy: null,
      lastHomeRestEndedAt: restEnd,
      unavailableUntil: null,
      unavailableReason: null,
    },
    {
      ...common,
      id: 'seed-driver-status-2',
      driverId: 'seed-driver-2',
      weeklyRestType: 'REDUCED' as const,
      weeklyRestAbroad: true,
      weeklyRestAtHome: false,
      recentWeeklyRests: [
        { type: 'REDUCED', endedAt: restEnd.toISOString(), abroad: true },
        { type: 'REGULAR', endedAt: previousRestEnd.toISOString(), abroad: false },
        { type: 'REGULAR', endedAt: at(previousRestEnd.getTime() - 7 * DAY).toISOString(), abroad: false },
      ],
      drivingLastWeekMinutes: 50 * 60,
      // 45 h − 24 h; due by the end of the third week after this one.
      compensationOwedMinutes: 21 * 60,
      compensationDueBy: at(monday + 4 * 7 * DAY),
      lastHomeRestEndedAt: previousRestEnd,
      unavailableUntil: null,
      unavailableReason: null,
    },
    {
      ...common,
      id: 'seed-driver-status-3',
      driverId: 'seed-driver-3',
      weeklyRestType: 'REGULAR' as const,
      weeklyRestAbroad: false,
      weeklyRestAtHome: true,
      recentWeeklyRests: null,
      drivingLastWeekMinutes: 40 * 60,
      compensationOwedMinutes: 0,
      compensationDueBy: null,
      lastHomeRestEndedAt: restEnd,
      unavailableUntil: at(restEnd.getTime() + 7 * DAY),
      unavailableReason: 'LEAVE' as const,
    },
  ];
}
