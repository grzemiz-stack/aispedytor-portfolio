import { Body, Controller, Delete, Get, Param, ParseBoolPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { AssignVehicleDto } from './dto/assign-vehicle.dto';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { CreateDriverStatusDto } from './dto/create-driver-status.dto';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { DriversService } from './drivers.service';

@ApiTags('drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @ApiOperation({ summary: 'Drivers of the company, by last name' })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Drivers with their assigned vehicle' })
  findAll(@Req() req: AuthenticatedRequest, @Query('active', new ParseBoolPipe({ optional: true })) active?: boolean) {
    return this.drivers.findAll(req.user.companyId, active);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One driver' })
  @ApiResponse({ status: 200, description: 'The driver with the assigned vehicle' })
  @ApiResponse({ status: 404, description: 'DRIVER_NOT_FOUND' })
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.drivers.findOne(id, req.user.companyId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a driver' })
  @ApiResponse({ status: 201, description: 'The new driver' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@Body() dto: CreateDriverDto, @Req() req: AuthenticatedRequest) {
    return this.drivers.create(req.user.companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a driver' })
  @ApiResponse({ status: 200, description: 'The changed driver' })
  @ApiResponse({ status: 404, description: 'DRIVER_NOT_FOUND' })
  update(@Param('id') id: string, @Body() dto: UpdateDriverDto, @Req() req: AuthenticatedRequest) {
    return this.drivers.update(id, req.user.companyId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a driver and the status history (the vehicle stays)' })
  @ApiResponse({ status: 200, description: '{ id, deleted: true }' })
  @ApiResponse({ status: 404, description: 'DRIVER_NOT_FOUND' })
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.drivers.remove(id, req.user.companyId);
  }

  @Put(':id/vehicle')
  @ApiOperation({ summary: 'Assign the driver to a power unit (single crew), or unassign with null' })
  @ApiResponse({ status: 200, description: 'The driver with the assigned vehicle' })
  @ApiResponse({ status: 404, description: 'DRIVER_NOT_FOUND, DRIVER_VEHICLE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'DRIVER_VEHICLE_ALREADY_ASSIGNED' })
  @ApiResponse({ status: 422, description: 'DRIVER_VEHICLE_NOT_A_POWER_UNIT (a trailer or semi-trailer)' })
  assignVehicle(@Param('id') id: string, @Body() dto: AssignVehicleDto, @Req() req: AuthenticatedRequest) {
    return this.drivers.assignVehicle(id, req.user.companyId, dto.vehicleId);
  }

  @Post(':id/status')
  @ApiOperation({ summary: 'Enter the manual driver status (a new row; the newest is current)' })
  @ApiResponse({ status: 201, description: 'The stored status' })
  @ApiResponse({ status: 400, description: 'Validation error, or DRIVER_STATUS_INVALID { field }' })
  @ApiResponse({ status: 404, description: 'DRIVER_NOT_FOUND' })
  addStatus(@Param('id') id: string, @Body() dto: CreateDriverStatusDto, @Req() req: AuthenticatedRequest) {
    return this.drivers.addStatus(id, req.user.companyId, req.user.userId, dto);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Current manual status and its history (newest first, at most 50)' })
  @ApiResponse({ status: 200, description: '{ current, history }' })
  @ApiResponse({ status: 404, description: 'DRIVER_NOT_FOUND' })
  statusHistory(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.drivers.statusHistory(id, req.user.companyId);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Can depart from, driving left, must be home by (561/2006, 2002/15)' })
  @ApiResponse({ status: 200, description: 'Availability with violations, warnings and notices as message codes' })
  @ApiResponse({ status: 404, description: 'DRIVER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'DRIVER_STATUS_MISSING — no status entered yet; DRIVER_STATUS_INCOMPLETE — the provider\'s status lacks a required value' })
  @ApiResponse({ status: 502, description: 'DRIVER_ACTIVITY_PROVIDER_FAILED — the driver activity provider failed for its source (`reason`)' })
  availability(@Param('id') id: string, @Query() query: AvailabilityQueryDto, @Req() req: AuthenticatedRequest) {
    return this.drivers.availability(id, req.user.companyId, query);
  }
}
