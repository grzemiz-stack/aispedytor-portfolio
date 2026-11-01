import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto, buildPaginatedResponse } from '../common/dto/pagination.dto';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, companyId: string, pagination: PaginationDto) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const where = { userId, companyId };

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, page, limit);
  }

  /**
   * Only the caller's own notification. The update has `userId` in its
   * condition, so another user's notification cannot be marked (no IDOR),
   * and it is one query — no gap between a check and the write. Nothing
   * updated → 404, the same for "does not exist" and "belongs to someone else".
   */
  async markRead(id: string, userId: string) {
    const { count } = await this.prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
    if (count === 0) throw new NotFoundException('Powiadomienie nie znalezione');
    return this.prisma.notification.findFirst({ where: { id, userId } });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  }

  create(
    companyId: string,
    userId: string,
    data: { type: NotificationType; title: string; message: string; offerId?: string },
  ) {
    return this.prisma.notification.create({
      data: { companyId, userId, type: data.type, title: data.title, message: data.message, offerId: data.offerId },
    });
  }
}
