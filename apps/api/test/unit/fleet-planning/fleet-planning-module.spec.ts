/**
 * The module assembles: the controller gets its service, the service gets
 * the activity provider through the token, and the default provider is the
 * manual one (the single registration point, fleet-planning.module.ts).
 */
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DRIVER_ACTIVITY_PROVIDER } from '../../../src/fleet-planning/activity/driver-activity-provider';
import { ManualDriverActivityProvider } from '../../../src/fleet-planning/activity/manual-driver-activity.provider';
import { DriversController } from '../../../src/fleet-planning/drivers.controller';
import { FleetPlanningModule } from '../../../src/fleet-planning/fleet-planning.module';
import { PrismaService } from '../../../src/prisma/prisma.service';

/** PrismaModule is global in the app; here a stub takes its place (no database). */
@Global()
@Module({ providers: [{ provide: PrismaService, useValue: {} }], exports: [PrismaService] })
class StubPrismaModule {}

@Module({ imports: [StubPrismaModule, FleetPlanningModule] })
class Root {}

it('assembles with the manual provider as the default', async () => {
  const app = await NestFactory.createApplicationContext(Root, { logger: false, abortOnError: false });
  try {
    expect(app.get(DRIVER_ACTIVITY_PROVIDER, { strict: false })).toBeInstanceOf(ManualDriverActivityProvider);
    expect(app.get(DriversController, { strict: false })).toBeDefined();
  } finally {
    await app.close();
  }
});
