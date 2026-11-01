import { Controller, Get, Patch, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'The logged-in user\'s notifications in their company, newest first, paginated' })
  @ApiResponse({ status: 200, description: 'Paginated list of notifications (`data`, `meta`)' })
  findAll(@Req() req: AuthenticatedRequest, @Query() pagination: PaginationDto) {
    return this.notificationsService.findAll(req.user.userId, req.user.companyId, pagination);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one of your own notifications as read' })
  @ApiResponse({ status: 200, description: 'The notification, now marked as read' })
  @ApiResponse({ status: 404, description: 'No such notification, or it belongs to another user (the same response for both)' })
  markRead(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.notificationsService.markRead(id, req.user.userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all of your unread notifications as read' })
  @ApiResponse({ status: 200, description: 'How many notifications were marked (`count`)' })
  markAllRead(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.markAllRead(req.user.userId);
  }
}
