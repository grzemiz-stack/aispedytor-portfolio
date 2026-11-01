import { Controller, Get, Patch, Delete, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { UploadLogoDto } from './dto/upload-logo.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the company of the logged-in user' })
  @ApiResponse({ status: 200, description: 'The company record' })
  getMyCompany(@Req() req: AuthenticatedRequest) {
    return this.companiesService.findOne(req.user.companyId);
  }

  @Patch('me')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update company data (ADMIN only); only the listed fields are accepted' })
  @ApiResponse({ status: 200, description: 'The updated company' })
  @ApiResponse({ status: 400, description: 'A field not on the editable list, an invalid value, or a currency change without the cost per km (COMPANY_CURRENCY_CHANGE_WITHOUT_COST)' })
  @ApiResponse({ status: 403, description: 'Caller is not an ADMIN' })
  update(@Body() dto: UpdateCompanyDto, @Req() req: AuthenticatedRequest) {
    return this.companiesService.update(req.user.companyId, dto);
  }

  // Only an ADMIN changes the logo, like the rest of the company data.
  @Patch('me/logo')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Upload the company logo as a data:image/... URI (ADMIN only). The service allows up to 700,000 characters (about 500 KB of image), but the default 100 kB JSON body limit rejects larger requests first (413)' })
  @ApiResponse({ status: 403, description: 'Caller is not an ADMIN' })
  @ApiResponse({ status: 200, description: 'The updated company, with the new logo' })
  @ApiResponse({ status: 400, description: 'Not a data:image/... URI, or longer than 700,000 characters' })
  uploadLogo(@Body() dto: UploadLogoDto, @Req() req: AuthenticatedRequest) {
    return this.companiesService.uploadLogo(req.user.companyId, dto.logoBase64);
  }

  @Delete('me/logo')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Remove the company logo (ADMIN only)' })
  @ApiResponse({ status: 403, description: 'Caller is not an ADMIN' })
  @ApiResponse({ status: 200, description: 'The updated company, without a logo' })
  removeLogo(@Req() req: AuthenticatedRequest) {
    return this.companiesService.removeLogo(req.user.companyId);
  }
}
