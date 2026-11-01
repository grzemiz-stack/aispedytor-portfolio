import { recomputeEconomics } from '../offers/recompute-economics';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaskQueueService } from '../common/queue/task-queue.service';
import { msg } from '../common/plan-messages';
import { UPDATABLE_COMPANY_FIELDS, type UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskQueue: TaskQueueService,
  ) {}

  async findOne(id: string) {
    const c = await this.prisma.company.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Firma nie znaleziona');
    return c;
  }

  /**
   * Writes only the fields on the allow-list. `ValidationPipe` on the
   * controller validates the body; this is a second layer — the service does
   * not assume that every call came through that controller.
   */
  async update(id: string, dto: UpdateCompanyDto) {
    await this.assertCurrencyChangeCarriesCost(id, dto);
    const data: Partial<Record<(typeof UPDATABLE_COMPANY_FIELDS)[number], unknown>> = {};
    for (const key of UPDATABLE_COMPANY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(dto, key) && dto[key] !== undefined) data[key] = dto[key];
    }
    const updated = await this.prisma.company.update({ where: { id }, data });
    // A change of the cost per km or its currency → the cost and margin of the
    // open offers again — in the background, not in this request: a company
    // with thousands of exchange offers does not wait for the PATCH, and a
    // recompute error gives no 500 with the rate already saved. From ACCEPTED
    // on the margin stays as it was.
    if (data.costPerKm !== undefined || data.costCurrency !== undefined) this.queueOpenOffersRecompute(id);
    return updated;
  }

  /**
   * Recomputing the company's NEW and ASSIGNED offers in the task queue. An
   * error → a log line (`warn`: companyId, the number of open offers), the rate
   * stays saved; `npm run offers:recompute-economics` fixes it.
   */
  private queueOpenOffersRecompute(companyId: string): void {
    const statuses = ['NEW', 'ASSIGNED'] as const;
    this.taskQueue
      .enqueue(() => recomputeEconomics(this.prisma, { companyId, statuses: [...statuses] }))
      .catch(async (err: unknown) => {
        const open = await this.prisma.offer
          .count({ where: { companyId, status: { in: [...statuses] } } })
          .catch(() => null);
        this.logger.warn(
          `Recomputing open offers after a cost per km change failed: companyId=${companyId}, ` +
            `open offers=${open ?? 'unknown'}: ${err instanceof Error ? err.message : String(err)}. ` +
            'The rate is saved; run npm run offers:recompute-economics.',
        );
      });
  }

  /**
   * The cost per km is an amount in `costCurrency`. Changing only the currency
   * would turn 4.20 PLN into 4.20 GBP without any conversion — so while a
   * cost is set, a new currency must come together with the cost (`null`
   * counts). The same currency, or no cost set — nothing to check.
   * See docs/decisions.md §3.
   */
  private async assertCurrencyChangeCarriesCost(id: string, dto: UpdateCompanyDto): Promise<void> {
    if (dto.costCurrency === undefined || dto.costPerKm !== undefined) return;
    const current = await this.prisma.company.findUnique({
      where: { id },
      select: { costPerKm: true, costCurrency: true },
    });
    if (!current) throw new NotFoundException('Firma nie znaleziona');
    if (current.costPerKm == null || current.costCurrency === dto.costCurrency) return;
    const m = msg('COMPANY_CURRENCY_CHANGE_WITHOUT_COST', {
      costPerKm: Number(current.costPerKm),
      fromCurrency: current.costCurrency,
      toCurrency: dto.costCurrency,
    });
    throw new BadRequestException({ statusCode: 400, ...m, message: m.code });
  }

  async uploadLogo(id: string, logoBase64: string) {
    // ~500KB limit: base64 of 500KB binary ≈ 700KB characters
    if (logoBase64.length > 700_000) {
      throw new BadRequestException('Logo jest zbyt duże (max 500 KB)');
    }
    // Must be a valid data URI for an image
    if (!logoBase64.startsWith('data:image/')) {
      throw new BadRequestException('Nieprawidłowy format logo — wymagany data URI (data:image/...)');
    }
    return this.prisma.company.update({ where: { id }, data: { logoBase64 } });
  }

  async removeLogo(id: string) {
    return this.prisma.company.update({ where: { id }, data: { logoBase64: null } });
  }
}
