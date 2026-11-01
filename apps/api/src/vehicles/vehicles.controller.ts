import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleQueryDto } from './dto/vehicle-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('vehicles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  // Must be before :id
  @Get('expiring')
  @ApiOperation({ summary: 'Vehicles with documents expiring within 30 days or already expired (inspection, insurance, tachograph, planned service, fuel card); also creates notifications for the caller' })
  @ApiResponse({ status: 200, description: 'Vehicles with `expiryWarnings` (field, label, date, daysLeft, severity: critical ≤ 7 days, warning ≤ 30)' })
  findExpiring(@Req() req: AuthenticatedRequest) {
    // `userId`, not `sub`: the user object from JwtStrategy.validate() has no
    // `sub` field, so reading `sub` would pass `undefined` to the service.
    return this.vehiclesService.findExpiring(req.user.companyId, req.user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'List the company’s vehicles, with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated list of vehicles' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: VehicleQueryDto) {
    const { status, dispatcherId, vehicleCategory, parentFor, ...pagination } = query;
    return this.vehiclesService.findAll(req.user.companyId, pagination, { status, dispatcherId, vehicleCategory, parentFor });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Vehicle details, with its attached units (`trailers`) and its parent vehicle' })
  @ApiResponse({ status: 200, description: 'The vehicle' })
  @ApiResponse({ status: 404, description: 'Vehicle not found in the caller’s company' })
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.vehiclesService.findOne(id, req.user.companyId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a vehicle to the fleet' })
  @ApiResponse({ status: 201, description: 'The created vehicle' })
  @ApiResponse({ status: 400, description: 'Validation error, a dispatcher from another company, or a parent vehicle that is not found or not allowed (message code)' })
  create(@Body() dto: CreateVehicleDto, @Req() req: AuthenticatedRequest) {
    return this.vehiclesService.create(req.user.companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a vehicle' })
  @ApiResponse({ status: 200, description: 'The updated vehicle' })
  @ApiResponse({ status: 404, description: 'Vehicle not found in the caller’s company' })
  update(@Param('id') id: string, @Body() dto: UpdateVehicleDto, @Req() req: AuthenticatedRequest) {
    return this.vehiclesService.update(id, req.user.companyId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a vehicle from the fleet (hard delete; attached units are detached)' })
  @ApiResponse({ status: 200, description: 'The deleted vehicle' })
  @ApiResponse({ status: 404, description: 'Vehicle not found in the caller’s company' })
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.vehiclesService.delete(id, req.user.companyId);
  }
}
