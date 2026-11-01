import { Module } from '@nestjs/common';
import { DRIVER_ACTIVITY_PROVIDER } from './activity/driver-activity-provider';
import { ManualDriverActivityProvider } from './activity/manual-driver-activity.provider';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

/**
 * Fleet planning (docs/fleet-planning/SPEC.md).
 *
 * The single place where the driver activity provider is chosen. Default:
 * the dispatcher's manual status. To plug in another source, replace
 * `useClass` with your implementation and run the contract tests against it
 * (src/fleet-planning/README.md, "Plugging in a provider").
 */
@Module({
  controllers: [DriversController],
  providers: [DriversService, { provide: DRIVER_ACTIVITY_PROVIDER, useClass: ManualDriverActivityProvider }],
  exports: [DRIVER_ACTIVITY_PROVIDER],
})
export class FleetPlanningModule {}
