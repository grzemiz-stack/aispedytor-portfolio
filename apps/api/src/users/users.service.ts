import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { msg } from '../common/plan-messages';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import * as bcrypt from 'bcryptjs';
import type { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enc: EncryptionService,
  ) {}

  async findAll(companyId: string) {
    const users = await this.prisma.user.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return users.map(u => this.decryptUser(u));
  }

  async findOne(id: string, companyId: string) {
    const user = await this.prisma.user.findFirst({ where: { id, companyId } });
    if (!user) throw new NotFoundException('Użytkownik nie znaleziony');
    return this.decryptUser(user);
  }

  async create(companyId: string, dto: CreateUserDto) {
    const emailHash = this.enc.hash(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { emailHash } });
    if (existing) throw new ConflictException('Email jest już zajęty');

    const user = await this.prisma.user.create({
      data: {
        companyId,
        emailEncrypted: this.enc.encrypt(dto.email),
        emailHash,
        passwordHash: await bcrypt.hash(dto.password, 12),
        firstNameEncrypted: this.enc.encrypt(dto.firstName),
        lastNameEncrypted: this.enc.encrypt(dto.lastName),
        phoneEncrypted: dto.phone ? this.enc.encrypt(dto.phone) : null,
        role: dto.role || 'DISPATCHER',
      },
    });
    return this.decryptUser(user);
  }

  async deactivate(id: string, companyId: string) {
    await this.findOne(id, companyId);
    // One transaction: the account inactive and without sessions — no window in
    // which a deactivated user can refresh tokens. Serializable: two admins
    // deactivating each other cannot leave the company without an active ADMIN.
    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const target = await tx.user.findFirst({ where: { id, companyId } });
        if (target?.role === 'ADMIN' && target.isActive) {
          const activeAdmins = await tx.user.count({ where: { companyId, role: 'ADMIN', isActive: true } });
          if (activeAdmins <= 1) {
            const m = msg('LAST_ACTIVE_ADMIN');
            throw new ConflictException({ statusCode: 409, ...m, message: m.code });
          }
        }
        const updated = await tx.user.update({ where: { id, companyId }, data: { isActive: false } });
        await tx.refreshToken.deleteMany({ where: { userId: id } });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      // P2034: the Serializable transaction lost to a concurrent change (e.g. two
      // admins at once). Not a server error — 409 with a code to retry on.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        const m = msg('CONCURRENT_CHANGE_RETRY');
        throw new ConflictException({ statusCode: 409, ...m, message: m.code });
      }
      throw e;
    }
    // The same shape as the rest of the API — the raw row would carry passwordHash and emailHash.
    return this.decryptUser(user);
  }

  private decryptUser(user: User) {
    return {
      id: user.id,
      companyId: user.companyId,
      email: this.enc.decrypt(user.emailEncrypted),
      firstName: this.enc.decrypt(user.firstNameEncrypted),
      lastName: this.enc.decrypt(user.lastNameEncrypted),
      phone: user.phoneEncrypted ? this.enc.decrypt(user.phoneEncrypted) : null,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }
}
