import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { msg } from '../common/plan-messages';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContractorDto } from './dto/create-contractor.dto';
import { UpdateContractorDto } from './dto/update-contractor.dto';
import { PaginationDto, buildPaginatedResponse } from '../common/dto/pagination.dto';
import { MemoryCacheService } from '../common/cache/memory-cache.service';

@Injectable()
export class ContractorsService {
  private readonly logger = new Logger(ContractorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCacheService,
  ) {}

  async findAll(companyId: string, pagination: PaginationDto) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const allowedSort = ['name', 'reliabilityScore', 'createdAt', 'rating'];
    const sortBy = allowedSort.includes(pagination.sortBy ?? '') ? pagination.sortBy! : 'name';
    const sortOrder = pagination.sortOrder ?? 'asc';

    const cacheKey = MemoryCacheService.buildKey('contractors', companyId, MemoryCacheService.hashQuery({ page, limit, sortBy, sortOrder }));
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const where = { companyId };
    const [data, total] = await Promise.all([
      this.prisma.contractor.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contractor.count({ where }),
    ]);

    const result = buildPaginatedResponse(data, total, page, limit);
    this.cache.set(cacheKey, result, 120);
    return result;
  }

  async findOne(id: string, companyId: string) {
    const c = await this.prisma.contractor.findFirst({ where: { id, companyId } });
    if (!c) throw new NotFoundException('Kontrahent nie znaleziony');
    return c;
  }

  /**
   * The blacklist (decisions §3b): only an ADMIN sets or clears it (there is
   * no other manager role); another role → 403 CONTRACTOR_BLACKLIST_ADMIN_ONLY.
   * The same value as now passes (a form may send everything). An ADMIN's
   * change is logged (who, when, which contractor).
   */
  private assertBlacklistChange(
    contractor: { id: string; name: string },
    from: boolean,
    to: boolean | undefined,
    actor: { userId: string; role: string } | null,
  ): void {
    if (to === undefined || to === from) return;
    if (actor?.role !== 'ADMIN') {
      const m = msg('CONTRACTOR_BLACKLIST_ADMIN_ONLY');
      throw new ForbiddenException({ statusCode: 403, ...m, message: m.code });
    }
    this.logger.warn(
      `Contractor ${contractor.id} (${contractor.name}) ${to ? 'blacklisted' : 'removed from the blacklist'} ` +
        `by user ${actor.userId} (ADMIN) at ${new Date().toISOString()}`,
    );
  }

  async create(companyId: string, dto: CreateContractorDto, actor: { userId: string; role: string } | null = null) {
    this.assertBlacklistChange({ id: '(new)', name: dto.name }, false, dto.isBlacklisted, actor);
    this.cache.deleteByPrefix(`contractors:${companyId}`);
    return this.prisma.contractor.create({
      data: {
        companyId,
        name: dto.name,
        taxId: dto.taxId,
        country: dto.country,
        city: dto.city,
        address: dto.address,
        contactPerson: dto.contactPerson,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        rating: dto.rating,
        // Risk ratings read by common/counterparty-risk.ts — they must be saved here, not only validated in the DTO.
        paymentRating: dto.paymentRating,
        reliabilityScore: dto.reliabilityScore,
        avgPaymentDays: dto.avgPaymentDays,
        notes: dto.notes,
        isActive: dto.isActive ?? true,
        isBlacklisted: dto.isBlacklisted ?? false,
      },
    });
  }

  async update(id: string, companyId: string, dto: UpdateContractorDto, actor: { userId: string; role: string } | null = null) {
    const current = await this.findOne(id, companyId);
    this.assertBlacklistChange(current, current.isBlacklisted, dto.isBlacklisted, actor);
    this.cache.deleteByPrefix(`contractors:${companyId}`);
    return this.prisma.contractor.update({
      where: { id, companyId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.taxId !== undefined && { taxId: dto.taxId }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.contactPerson !== undefined && { contactPerson: dto.contactPerson }),
        ...(dto.contactEmail !== undefined && { contactEmail: dto.contactEmail }),
        ...(dto.contactPhone !== undefined && { contactPhone: dto.contactPhone }),
        ...(dto.rating !== undefined && { rating: dto.rating }),
        ...(dto.paymentRating !== undefined && { paymentRating: dto.paymentRating }),
        ...(dto.reliabilityScore !== undefined && { reliabilityScore: dto.reliabilityScore }),
        ...(dto.avgPaymentDays !== undefined && { avgPaymentDays: dto.avgPaymentDays }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isBlacklisted !== undefined && { isBlacklisted: dto.isBlacklisted }),
      },
    });
  }

  /**
   * Deleting a contractor that has any offers → 409 CONTRACTOR_HAS_OFFERS
   * { offers } (decisions §3b): the `ON DELETE SET NULL` key would clear the
   * offers' contractor, and with it the blacklist block, without a trace.
   * Deactivate instead. Without offers — deleted as before.
   */
  async delete(id: string, companyId: string) {
    await this.findOne(id, companyId);
    const offers = await this.prisma.offer.count({ where: { contractorId: id, companyId } });
    if (offers > 0) {
      const m = msg('CONTRACTOR_HAS_OFFERS', { offers });
      throw new ConflictException({ statusCode: 409, ...m, message: m.code });
    }
    this.cache.deleteByPrefix(`contractors:${companyId}`);
    return this.prisma.contractor.delete({ where: { id, companyId } });
  }
}
