/**
 * ManualDriverActivityProvider against the contract on a real PostgreSQL
 * (run by tools/demo-test.sh). Creates its own company, removes it at the end.
 */
import { PrismaClient } from '@prisma/client';
import { runDriverActivityProviderContract } from '../contract/driver-activity-provider.contract';
import { ManualDriverActivityProvider } from '../../src/fleet-planning/activity/manual-driver-activity.provider';
import type { PrismaService } from '../../src/prisma/prisma.service';

const prisma = new PrismaClient();
let companyId: string;

afterAll(async () => {
  if (companyId) await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

runDriverActivityProviderContract('ManualDriverActivityProvider (PostgreSQL)', {
  make: async () => {
    companyId = (await prisma.company.create({ data: { name: 'Fleet planning provider contract' } })).id;
    const driver = await prisma.driver.create({ data: { companyId, firstName: 'Contract', lastName: 'Driver' } });
    const base = {
      driverId: driver.id,
      weeklyRestEndedAt: new Date('2026-10-05T06:00:00Z'),
      weeklyRestType: 'REGULAR' as const,
      drivingThisWeekMinutes: 900,
      drivingLastWeekMinutes: 2400,
      lastHomeRestEndedAt: new Date('2026-10-05T06:00:00Z'),
      recentWeeklyRests: [{ type: 'REGULAR', endedAt: '2026-10-05T06:00:00.000Z', abroad: false }],
    };
    // An older status and the current one: the provider must return the newer.
    await prisma.driverStatus.create({ data: { ...base, asOf: new Date('2026-10-06T08:00:00Z'), drivingThisWeekMinutes: 1, createdAt: new Date('2026-10-06T08:00:00Z') } });
    await prisma.driverStatus.create({ data: { ...base, asOf: new Date('2026-10-07T08:00:00Z'), createdAt: new Date('2026-10-07T08:00:00Z') } });
    const provider = new ManualDriverActivityProvider(prisma as unknown as PrismaService);
    expect((await provider.currentStatus(driver.id))?.drivingThisWeekMinutes).toBe(900);
    return { provider, knownDriverId: driver.id };
  },
});
