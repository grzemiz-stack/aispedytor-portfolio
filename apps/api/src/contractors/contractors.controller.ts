import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ContractorsService } from './contractors.service';
import { CreateContractorDto } from './dto/create-contractor.dto';
import { UpdateContractorDto } from './dto/update-contractor.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('contractors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contractors')
export class ContractorsController {
  constructor(private readonly contractorsService: ContractorsService) {}

  @Get()
  @ApiOperation({ summary: 'List contractors (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated list of the caller company contractors; sortBy: name, rating, reliabilityScore or createdAt (anything else sorts by name)' })
  findAll(@Req() req: AuthenticatedRequest, @Query() pagination: PaginationDto) {
    return this.contractorsService.findAll(req.user.companyId, pagination);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one contractor' })
  @ApiResponse({ status: 200, description: 'The contractor' })
  @ApiResponse({ status: 404, description: 'Contractor not found in the caller company' })
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.contractorsService.findOne(id, req.user.companyId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a contractor' })
  @ApiResponse({ status: 201, description: 'The created contractor' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'CONTRACTOR_BLACKLIST_ADMIN_ONLY — only an ADMIN sets isBlacklisted: true' })
  create(@Body() dto: CreateContractorDto, @Req() req: AuthenticatedRequest) {
    return this.contractorsService.create(req.user.companyId, dto, { userId: req.user.userId, role: req.user.role });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a contractor (fields left out stay unchanged)' })
  @ApiResponse({ status: 200, description: 'The updated contractor' })
  @ApiResponse({ status: 403, description: 'CONTRACTOR_BLACKLIST_ADMIN_ONLY — only an ADMIN changes isBlacklisted' })
  @ApiResponse({ status: 404, description: 'Contractor not found in the caller company' })
  update(@Param('id') id: string, @Body() dto: UpdateContractorDto, @Req() req: AuthenticatedRequest) {
    return this.contractorsService.update(id, req.user.companyId, dto, { userId: req.user.userId, role: req.user.role });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a contractor (hard delete)' })
  @ApiResponse({ status: 200, description: 'The deleted contractor (only one without offers)' })
  @ApiResponse({ status: 409, description: 'CONTRACTOR_HAS_OFFERS { offers } — the contractor has offers; deactivate it instead' })
  @ApiResponse({ status: 404, description: 'Contractor not found in the caller company' })
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.contractorsService.delete(id, req.user.companyId);
  }
}
