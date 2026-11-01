import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DataRetentionTask {
  private readonly logger = new Logger(DataRetentionTask.name);

  // Configurable retention periods (days)
  private readonly TOKEN_RETENTION_DAYS = 30;
  private readonly NOTIFICATION_RETENTION_DAYS = 60;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 2 * * 0') // Every Sunday at 2:00 AM
  async handleRetention() {
    const now = new Date();

    // 1. Delete refresh tokens created more than 30 days ago (whether expired or not)
    const tokenCutoff = new Date(now);
    tokenCutoff.setDate(tokenCutoff.getDate() - this.TOKEN_RETENTION_DAYS);

    const tokensResult = await this.prisma.refreshToken.deleteMany({
      where: { createdAt: { lt: tokenCutoff } },
    });

    // 2. Delete read notifications older than 60 days
    const notifCutoff = new Date(now);
    notifCutoff.setDate(notifCutoff.getDate() - this.NOTIFICATION_RETENTION_DAYS);

    const notifsResult = await this.prisma.notification.deleteMany({
      where: {
        isRead: true,
        createdAt: { lt: notifCutoff },
      },
    });

    this.logger.log(
      `[DataRetention] Cleaned: ${tokensResult.count} tokens, ${notifsResult.count} notifications`,
    );
  }
}
