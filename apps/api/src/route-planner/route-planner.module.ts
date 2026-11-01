import { Module } from '@nestjs/common';
import { RoutePlannerController } from './route-planner.controller';
import { RoutePlannerService } from './route-planner.service';
import { OsrmAdapterService } from './osrm-adapter.service';
import { RouteCalculatorService } from './osrm-calculator.service';

@Module({
  controllers: [RoutePlannerController],
  providers: [RoutePlannerService, RouteCalculatorService, OsrmAdapterService],
  exports: [RoutePlannerService, RouteCalculatorService, OsrmAdapterService],
})
export class RoutePlannerModule {}
