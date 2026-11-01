import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { PaginationDto, buildPaginatedResponse } from '../common/dto/pagination.dto';
import { MemoryCacheService } from '../common/cache/memory-cache.service';
import { VehicleStatus, type NotificationType, type Vehicle } from '@prisma/client';
import { ALLOWED_PARENTS, DEFAULT_VEHICLE_CATEGORY, attachmentProblem, type TowedCategory } from '../common/vehicle-category';
import { msg } from '../common/plan-messages';

export interface ExpiryInfo {
  field: string;
  label: string;
  date: Date;
  daysLeft: number;
  severity: 'critical' | 'warning' | 'ok';
}

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCacheService,
  ) {}

  async findAll(companyId: string, pagination: PaginationDto, filters?: { status?: VehicleStatus; dispatcherId?: string; vehicleCategory?: string; parentFor?: TowedCategory }) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const allowedSort = ['createdAt', 'plateNumber', 'brand', 'status'];
    const sortBy = allowedSort.includes(pagination.sortBy ?? '') ? pagination.sortBy! : 'createdAt';
    const sortOrder = pagination.sortOrder ?? 'desc';

    const cacheKey = MemoryCacheService.buildKey('vehicles', companyId, MemoryCacheService.hashQuery({ page, limit, sortBy, sortOrder, ...filters }));
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const where = {
      companyId,
      ...(filters?.status && { status: filters.status }),
      ...(filters?.dispatcherId && { dispatcherId: filters.dispatcherId }),
      ...(filters?.vehicleCategory && { vehicleCategory: filters.vehicleCategory }),
      // "What can I attach this to" list — the rule is in common/vehicle-category.ts.
      ...(filters?.parentFor && { vehicleCategory: { in: [...ALLOWED_PARENTS[filters.parentFor]] } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    const result = buildPaginatedResponse(data, total, page, limit);
    this.cache.set(cacheKey, result, 60);
    return result;
  }

  async findOne(id: string, companyId: string) {
    const v = await this.prisma.vehicle.findFirst({
      where: { id, companyId },
      include: {
        trailers: {
          select: {
            id: true,
            plateNumber: true,
            vehicleCategory: true,
            status: true,
            brand: true,
            model: true,
          },
        },
        parentVehicle: {
          select: {
            id: true,
            plateNumber: true,
            brand: true,
            model: true,
          },
        },
      },
    });
    if (!v) throw new NotFoundException('Pojazd nie znaleziony');
    return v;
  }

  /** The vehicle's dispatcher must be a user of the caller's company. */
  private async assertDispatcherInCompany(companyId: string, dispatcherId: string | null | undefined): Promise<void> {
    if (!dispatcherId) return;
    const user = await this.prisma.user.findFirst({ where: { id: dispatcherId, companyId }, select: { id: true } });
    if (!user) {
      const m = msg('VEHICLE_DISPATCHER_NOT_FOUND');
      throw new BadRequestException({ statusCode: 400, ...m, message: m.code });
    }
  }

  async create(companyId: string, dto: CreateVehicleDto) {
    await this.assertDispatcherInCompany(companyId, dto.dispatcherId);
    await this.assertAttachment(companyId, dto.vehicleCategory ?? DEFAULT_VEHICLE_CATEGORY, dto.parentVehicleId);
    this.cache.deleteByPrefix(`vehicles:${companyId}`);
    return this.prisma.vehicle.create({
      data: {
        companyId,
        plateNumber: dto.plateNumber,
        licensePlate: dto.licensePlate,
        ocrNumber: dto.ocrNumber,
        brand: dto.brand,
        model: dto.model,
        vin: dto.vin,
        year: dto.year,
        vehicleType: dto.vehicleType,
        vehicleCategory: dto.vehicleCategory ?? 'TRUCK',
        trailerType: dto.trailerType,
        parentVehicleId: dto.parentVehicleId ?? null,
        maxWeightKg: dto.maxWeightKg,
        grossVehicleWeightKg: dto.grossVehicleWeightKg,
        curbWeightKg: dto.curbWeightKg,
        maxVolumeM3: dto.maxVolumeM3,
        lengthM: dto.lengthM,
        heightM: dto.heightM,
        widthM: dto.widthM,
        axleCount: dto.axleCount,
        maxLoadingMeters: dto.maxLoadingMeters,
        maxPalletCount: dto.maxPalletCount,
        hasAdr: dto.hasAdr ?? false,
        hasGps: dto.hasGps ?? false,
        adrClasses: dto.adrClasses ?? [],
        currentCity: dto.currentCity,
        currentCountry: dto.currentCountry,
        dispatcherId: dto.dispatcherId,
        technicalInspectionFrom: dto.technicalInspectionFrom ? new Date(dto.technicalInspectionFrom) : null,
        technicalInspectionTo: dto.technicalInspectionTo ? new Date(dto.technicalInspectionTo) : null,
        insuranceFrom: dto.insuranceFrom ? new Date(dto.insuranceFrom) : null,
        insuranceTo: dto.insuranceTo ? new Date(dto.insuranceTo) : null,
        tachographLegalizationFrom: dto.tachographLegalizationFrom ? new Date(dto.tachographLegalizationFrom) : null,
        tachographLegalizationTo: dto.tachographLegalizationTo ? new Date(dto.tachographLegalizationTo) : null,
        plannedMaintenanceDate: dto.plannedMaintenanceDate ? new Date(dto.plannedMaintenanceDate) : null,
        plannedMaintenanceNotes: dto.plannedMaintenanceNotes,
        fuelCardType: dto.fuelCardType,
        fuelCardLast4: dto.fuelCardLast4,
        fuelCardExpiry: dto.fuelCardExpiry ? new Date(dto.fuelCardExpiry) : null,
        notes: dto.notes,
      },
    });
  }

  async update(id: string, companyId: string, dto: UpdateVehicleDto) {
    const current = await this.findOne(id, companyId);
    // The same rule as on create: the dispatcher only from the caller's company.
    await this.assertDispatcherInCompany(companyId, dto.dispatcherId);
    // The pair is checked when either side of it changes: the parent, or the
    // category of a record that is already attached.
    if (dto.parentVehicleId !== undefined || dto.vehicleCategory !== undefined) {
      const parentId = dto.parentVehicleId !== undefined ? dto.parentVehicleId || null : current.parentVehicleId;
      await this.assertAttachment(companyId, dto.vehicleCategory ?? current.vehicleCategory, parentId, id);
    }
    // The other side of the same rule: changing the PARENT's category must not
    // leave attached records in a pair the rule does not allow
    // (e.g. a tractor with a semi-trailer switched to a van).
    if (dto.vehicleCategory !== undefined && dto.vehicleCategory !== current.vehicleCategory) {
      await this.assertAttachedStillFit(id, companyId, dto.vehicleCategory);
    }
    this.cache.deleteByPrefix(`vehicles:${companyId}`);
    return this.prisma.vehicle.update({
      where: { id, companyId },
      data: {
        ...(dto.plateNumber !== undefined && { plateNumber: dto.plateNumber }),
        ...(dto.licensePlate !== undefined && { licensePlate: dto.licensePlate }),
        ...(dto.ocrNumber !== undefined && { ocrNumber: dto.ocrNumber }),
        ...(dto.brand !== undefined && { brand: dto.brand }),
        ...(dto.model !== undefined && { model: dto.model }),
        ...(dto.vin !== undefined && { vin: dto.vin }),
        ...(dto.year !== undefined && { year: dto.year }),
        ...(dto.vehicleType && { vehicleType: dto.vehicleType }),
        ...(dto.vehicleCategory !== undefined && { vehicleCategory: dto.vehicleCategory }),
        ...(dto.trailerType !== undefined && { trailerType: dto.trailerType }),
        ...(dto.parentVehicleId !== undefined && { parentVehicleId: dto.parentVehicleId || null }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.maxWeightKg !== undefined && { maxWeightKg: dto.maxWeightKg }),
        ...(dto.grossVehicleWeightKg !== undefined && { grossVehicleWeightKg: dto.grossVehicleWeightKg }),
        ...(dto.curbWeightKg !== undefined && { curbWeightKg: dto.curbWeightKg }),
        ...(dto.maxVolumeM3 !== undefined && { maxVolumeM3: dto.maxVolumeM3 }),
        ...(dto.axleCount !== undefined && { axleCount: dto.axleCount }),
        ...(dto.maxLoadingMeters !== undefined && { maxLoadingMeters: dto.maxLoadingMeters }),
        ...(dto.maxPalletCount !== undefined && { maxPalletCount: dto.maxPalletCount }),
        ...(dto.hasAdr !== undefined && { hasAdr: dto.hasAdr }),
        ...(dto.hasGps !== undefined && { hasGps: dto.hasGps }),
        ...(dto.currentCity !== undefined && { currentCity: dto.currentCity }),
        ...(dto.currentCountry !== undefined && { currentCountry: dto.currentCountry }),
        ...(dto.availableFrom && { availableFrom: new Date(dto.availableFrom) }),
        ...(dto.freeMeters !== undefined && { freeMeters: dto.freeMeters }),
        ...(dto.freeWeightKg !== undefined && { freeWeightKg: dto.freeWeightKg }),
        ...(dto.currentDirection !== undefined && { currentDirection: dto.currentDirection }),
        ...(dto.technicalInspectionFrom !== undefined && { technicalInspectionFrom: dto.technicalInspectionFrom ? new Date(dto.technicalInspectionFrom) : null }),
        ...(dto.technicalInspectionTo !== undefined && { technicalInspectionTo: dto.technicalInspectionTo ? new Date(dto.technicalInspectionTo) : null }),
        ...(dto.insuranceFrom !== undefined && { insuranceFrom: dto.insuranceFrom ? new Date(dto.insuranceFrom) : null }),
        ...(dto.insuranceTo !== undefined && { insuranceTo: dto.insuranceTo ? new Date(dto.insuranceTo) : null }),
        ...(dto.tachographLegalizationFrom !== undefined && { tachographLegalizationFrom: dto.tachographLegalizationFrom ? new Date(dto.tachographLegalizationFrom) : null }),
        ...(dto.tachographLegalizationTo !== undefined && { tachographLegalizationTo: dto.tachographLegalizationTo ? new Date(dto.tachographLegalizationTo) : null }),
        ...(dto.plannedMaintenanceDate !== undefined && { plannedMaintenanceDate: dto.plannedMaintenanceDate ? new Date(dto.plannedMaintenanceDate) : null }),
        ...(dto.plannedMaintenanceNotes !== undefined && { plannedMaintenanceNotes: dto.plannedMaintenanceNotes }),
        ...(dto.fuelCardType !== undefined && { fuelCardType: dto.fuelCardType }),
        ...(dto.fuelCardLast4 !== undefined && { fuelCardLast4: dto.fuelCardLast4 }),
        ...(dto.fuelCardExpiry !== undefined && { fuelCardExpiry: dto.fuelCardExpiry ? new Date(dto.fuelCardExpiry) : null }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        // Dimensions, ADR classes and the dispatcher — accepted by the DTO and
        // sent by the edit form, so they must be saved.
        ...(dto.lengthM !== undefined && { lengthM: dto.lengthM }),
        ...(dto.heightM !== undefined && { heightM: dto.heightM }),
        ...(dto.widthM !== undefined && { widthM: dto.widthM }),
        // The column is a list (no null): `null` from the form = "clear" = an empty list (decisions §7).
        ...(dto.adrClasses !== undefined && { adrClasses: dto.adrClasses ?? [] }),
        ...(dto.dispatcherId !== undefined && { dispatcherId: dto.dispatcherId || null }),
      },
    });
  }

  async delete(id: string, companyId: string) {
    await this.findOne(id, companyId);
    this.cache.deleteByPrefix(`vehicles:${companyId}`);
    return this.prisma.vehicle.delete({ where: { id, companyId } });
  }

  private getExpiryInfo(vehicle: Vehicle): ExpiryInfo[] {
    const now = new Date();
    const checks: Array<{ field: string; label: string; date: Date | null }> = [
      { field: 'technicalInspectionTo', label: 'Przegląd techniczny', date: vehicle.technicalInspectionTo },
      { field: 'insuranceTo', label: 'Ubezpieczenie OC/AC', date: vehicle.insuranceTo },
      { field: 'tachographLegalizationTo', label: 'Legalizacja tachografu', date: vehicle.tachographLegalizationTo },
      { field: 'plannedMaintenanceDate', label: 'Planowany serwis', date: vehicle.plannedMaintenanceDate },
      { field: 'fuelCardExpiry', label: 'Karta paliwowa', date: vehicle.fuelCardExpiry },
    ];

    return checks
      .filter((c) => c.date !== null)
      .map((c) => {
        const daysLeft = Math.ceil((c.date!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
          field: c.field,
          label: c.label,
          date: c.date!,
          daysLeft,
          severity: (daysLeft <= 7 ? 'critical' : daysLeft <= 30 ? 'warning' : 'ok') as 'critical' | 'warning' | 'ok',
        };
      })
      .filter((c) => c.daysLeft <= 30);
  }

  async findExpiring(companyId: string, userId: string) {
    const vehicles = await this.prisma.vehicle.findMany({ where: { companyId } });
    const result = vehicles
      .map((v) => ({ ...v, expiryWarnings: this.getExpiryInfo(v) }))
      .filter((v) => v.expiryWarnings.length > 0);

    await this.createExpiryNotifications(companyId, userId, result);

    return result;
  }

  private async createExpiryNotifications(companyId: string, userId: string, vehicles: (Vehicle & { expiryWarnings: ExpiryInfo[] })[]) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    const notifTypeMap: Record<string, NotificationType> = {
      technicalInspectionTo: 'VEHICLE_INSPECTION_EXPIRY',
      insuranceTo: 'VEHICLE_INSURANCE_EXPIRY',
      tachographLegalizationTo: 'VEHICLE_TACHOGRAPH_EXPIRY',
      plannedMaintenanceDate: 'VEHICLE_MAINTENANCE',
      fuelCardExpiry: 'VEHICLE_FUEL_CARD_EXPIRY',
    };

    for (const vehicle of vehicles) {
      for (const warning of vehicle.expiryWarnings as ExpiryInfo[]) {
        const notifType = notifTypeMap[warning.field];
        if (!notifType) continue;

        const since = warning.severity === 'critical' ? todayStart : weekStart;

        const existing = await this.prisma.notification.findFirst({
          where: {
            companyId,
            userId,
            type: notifType,
            message: { contains: vehicle.plateNumber },
            createdAt: { gte: since },
          },
        });

        if (!existing) {
          await this.prisma.notification.create({
            data: {
              companyId,
              userId,
              type: notifType,
              title: `${warning.label} — ${vehicle.plateNumber}`,
              message: `Pojazd ${vehicle.plateNumber}: ${warning.label} wygasa za ${warning.daysLeft} dni (${warning.date.toLocaleDateString('pl-PL')})`,
            },
          });
        }
      }
    }
  }

  /**
   * The attaching rule (common/vehicle-category.ts), applied on every write of
   * `parentVehicleId`. The parent is looked up ONLY in the caller's company —
   * otherwise a record could be attached to another company's vehicle.
   * A wrong pair = 400 with a message code; the web app builds the sentence.
   */
  private async assertAttachment(
    companyId: string,
    childCategory: string,
    parentVehicleId: string | null | undefined,
    selfId?: string,
  ): Promise<void> {
    if (!parentVehicleId) return;
    const parent =
      parentVehicleId === selfId
        ? null
        : await this.prisma.vehicle.findFirst({
            where: { id: parentVehicleId, companyId },
            select: { vehicleCategory: true },
          });
    if (!parent) {
      const notFound = msg('VEHICLE_ATTACH_PARENT_NOT_FOUND');
      throw new BadRequestException({ statusCode: 400, ...notFound, message: notFound.code });
    }
    const problem = attachmentProblem(childCategory, parent.vehicleCategory);
    if (problem) {
      throw new BadRequestException({ statusCode: 400, ...problem, message: problem.code });
    }
  }

  /** Every record attached to `parentId` must fit the parent's new category. */
  private async assertAttachedStillFit(parentId: string, companyId: string, newCategory: string): Promise<void> {
    const attached = await this.prisma.vehicle.findMany({
      where: { parentVehicleId: parentId, companyId },
      select: { plateNumber: true, vehicleCategory: true },
    });
    for (const child of attached) {
      const problem = attachmentProblem(child.vehicleCategory, newCategory);
      if (problem) {
        const broken = msg('VEHICLE_CATEGORY_BREAKS_ATTACHMENT', {
          parentCategory: newCategory,
          childCategory: child.vehicleCategory,
          childPlate: child.plateNumber,
          allowedParents: String(problem.params?.allowedParents ?? ''),
        });
        throw new BadRequestException({ statusCode: 400, ...broken, message: broken.code });
      }
    }
  }
}
