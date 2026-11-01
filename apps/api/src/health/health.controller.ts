import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { MemoryCacheService } from '../common/cache/memory-cache.service';
import { TaskQueueService } from '../common/queue/task-queue.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

const APP_START = Date.now();

/** This company's Trans.eu connection — read from the database, not assumed. */
export type TransEuStatus = 'not_configured' | 'not_connected' | 'connected' | 'expired';

/** The answer of GET /health/integrations (also what is cached for 30 s). */
export interface IntegrationsStatus {
  database: 'ok' | 'error';
  transEu: TransEuStatus;
  uptime: number;
  version: string;
  cache: ReturnType<MemoryCacheService['getStats']>;
  queue: ReturnType<TaskQueueService['getStats']>;
}

/**
 * Dependency status — for logged-in users only.
 *
 * It shows cache and queue statistics, so it is not public. The Trans.eu
 * status comes from the company's stored connection, not a fixed value.
 * The only public check is "alive": `/api/health` in main.ts → {status:'ok'}.
 */
@ApiTags('health')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: MemoryCacheService,
    private readonly taskQueue: TaskQueueService,
  ) {}

  @Get('integrations')
  @ApiOperation({ summary: 'Dependency status: database, the company\'s Trans.eu connection, cache, queue' })
  @ApiResponse({ status: 200, description: 'Database and Trans.eu status, uptime in seconds, version, cache and queue statistics; cached for 30 s per company' })
  @ApiResponse({ status: 401, description: 'Not logged in' })
  async getIntegrations(@Req() req: AuthenticatedRequest): Promise<IntegrationsStatus> {
    const companyId = req.user.companyId;
    // Cached per company — the Trans.eu status is per company.
    const cacheKey = `health:integrations:${companyId}`;
    const cached = this.cache.get<IntegrationsStatus>(cacheKey);
    if (cached) return cached;

    // 1. Database — a real query.
    let database: 'ok' | 'error' = 'error';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'ok';
    } catch {
      // The database does not answer: it stays 'error'.
    }

    // 2. Trans.eu — this company's connection state, from the database.
    const transEu = await this.transEuStatus(companyId);

    const result: IntegrationsStatus = {
      database,
      transEu,
      uptime: Math.floor((Date.now() - APP_START) / 1000),
      // Version from package.json when started through npm; otherwise an explicit "unknown", never a made-up 1.0.0.
      version: process.env.npm_package_version ?? 'unknown',
      cache: this.cache.getStats(),
      queue: this.taskQueue.getStats(),
    };

    this.cache.set(cacheKey, result, 30);
    return result;
  }

  private async transEuStatus(companyId: string): Promise<TransEuStatus> {
    if (!this.config.get<string>('TRANS_EU_CLIENT_ID')) return 'not_configured';
    const conn = await this.prisma.exchangeConnection.findUnique({
      where: { companyId_exchange: { companyId, exchange: 'TRANS_EU' } },
      select: { status: true },
    });
    if (!conn) return 'not_connected';
    if (conn.status === 'ACTIVE') return 'connected';
    if (conn.status === 'EXPIRED') return 'expired';
    return 'not_connected';
  }
}
