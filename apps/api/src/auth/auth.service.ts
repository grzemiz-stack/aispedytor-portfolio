import { Injectable, UnauthorizedException, ForbiddenException, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { LoginDto } from './dto/login.dto';
import { requireJwtSecret } from '../common/config/secrets';
import { currencyForCountry } from '../common/company-currency';
import { normalizePolishTaxId } from '../common/tax-id';
import type { RegisterCompanyDto } from './dto/register-company.dto';
import { msg, type PlanMessageCode } from '../common/plan-messages';
import type { ChangePasswordDto } from '../users/dto/change-password.dto';

/**
 * A refresh token in the database = SHA-256 (hex) — only the client knows the
 * token itself. The same function as in the migration
 * `20261010140000_refresh_token_hash` (`encode(sha256(convert_to(token,
 * 'UTF8')), 'hex')`). No salt: the token is 32 random bytes, there is nothing
 * to guess from a dictionary.
 */
export const hashRefreshToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly enc: EncryptionService,
  ) {}

  async login(dto: LoginDto) {
    const emailHash = this.enc.hash(dto.email);
    const user = await this.prisma.user.findUnique({ where: { emailHash } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Nieprawidłowy email lub hasło');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Nieprawidłowy email lub hasło');

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(user.id, user.companyId, user.role, dto.email);
    return {
      ...tokens,
      user: {
        id: user.id,
        companyId: user.companyId,
        email: dto.email,
        firstName: this.enc.decrypt(user.firstNameEncrypted),
        lastName: this.enc.decrypt(user.lastNameEncrypted),
        role: user.role,
      },
    };
  }

  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      include: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      if (stored) {
        await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      }
      throw new ForbiddenException('Refresh token wygasł lub jest nieprawidłowy');
    }

    // Deactivated account: the token is deleted and no new pair is issued — the
    // same rule as `login`, which also refuses inactive users.
    if (!stored.user.isActive) {
      await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new ForbiddenException('Refresh token wygasł lub jest nieprawidłowy');
    }

    // Rotation: the used token is marked, not deleted, so a second use can be
    // recognised. The `usedAt: null` condition lets exactly one of two
    // concurrent refreshes win (before, the second ended in 500 on `delete`);
    // the loser — like an already used token — counts as reuse.
    const { count: claimed } = await this.prisma.refreshToken.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed === 0) {
      await this.prisma.refreshToken.deleteMany({ where: { familyId: stored.familyId } });
      this.logger.warn(`Refresh token reuse for user ${stored.user.id} — token family revoked`);
      throw new ForbiddenException('Refresh token wygasł lub jest nieprawidłowy');
    }

    const email = this.enc.decrypt(stored.user.emailEncrypted);
    return this.generateTokens(stored.user.id, stored.user.companyId, stored.user.role, email, stored.familyId);
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    return { message: 'Wylogowano' };
  }

  /**
   * Change of the user's own password (PATCH /users/me/password).
   *
   * Checks the current password, saves the hash of the new one and ends ALL
   * of the user's sessions (deletes their refresh tokens) — whoever knew the
   * old password loses access once their access token expires. The current
   * session gets a new token pair, so the settings screen does not log the
   * user out.
   */
  async changePassword(userId: string, companyId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId, isActive: true } });
    if (!user) throw new NotFoundException('Użytkownik nie znaleziony');

    const reject = (code: PlanMessageCode) => {
      const m = msg(code);
      return new BadRequestException({ statusCode: 400, ...m, message: m.code });
    };
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) throw reject('PASSWORD_CURRENT_INVALID');
    if (dto.newPassword === dto.currentPassword) throw reject('PASSWORD_UNCHANGED');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) },
    });
    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    return this.generateTokens(user.id, user.companyId, user.role, this.enc.decrypt(user.emailEncrypted));
  }

  /** `familyId` given = a refresh in the same family; none = a new login, a new family. */
  private async generateTokens(userId: string, companyId: string, role: string, email: string, familyId: string = uuidv4()) {
    const payload = { sub: userId, companyId, role, email };

    const accessToken = this.jwt.sign(payload, {
      secret: requireJwtSecret(this.config.get('JWT_SECRET')),
      expiresIn: this.config.get('JWT_EXPIRES_IN') || '15m',
    });

    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: { tokenHash: hashRefreshToken(refreshToken), userId, expiresAt, familyId },
    });

    return { accessToken, refreshToken };
  }


  /**
   * Registration of a company and its administrator.
   *
   * - a taken e-mail → 409 REGISTER_EMAIL_TAKEN (also when two registrations
   *   at once are decided by the unique `email_hash` index);
   * - the tax ID is checked only for companies in PL: 10 digits with the
   *   check digit, else 400 REGISTER_TAX_ID_INVALID; another country's number
   *   is stored as given;
   * - company and user in one transaction — a failure on the user leaves no
   *   company without an account. The password hash is computed before the
   *   transaction (bcrypt is slow), the tokens only after it commits.
   */
  async registerCompany(dto: RegisterCompanyDto): Promise<{ accessToken: string; refreshToken: string; userId: string; companyId: string }> {
    // E-mail encryption and hashing go through EncryptionService — the same key
    // as the rest of the application, with no fallback value.
    const encrypt = (text: string): string => this.enc.encrypt(text);
    const emailHash = this.enc.hash(dto.email);
    const coded = (Exception: typeof ConflictException | typeof BadRequestException, status: number, code: PlanMessageCode) => {
      const m = msg(code);
      return new Exception({ statusCode: status, ...m, message: m.code });
    };
    const emailTaken = () => coded(ConflictException, 409, 'REGISTER_EMAIL_TAKEN');

    const existing = await this.prisma.user.findUnique({ where: { emailHash } });
    if (existing) throw emailTaken();

    const country = (dto.country || 'PL').trim().toUpperCase();
    let taxId = dto.taxId.trim();
    if (country === 'PL') {
      const nip = normalizePolishTaxId(taxId);
      if (!nip) throw coded(BadRequestException, 400, 'REGISTER_TAX_ID_INVALID');
      taxId = nip;
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);

    let company: { id: string; name: string };
    let user: { id: string };
    try {
      ({ company, user } = await this.prisma.$transaction(async (tx) => {
        // Plans, usage limits and billing are out of scope — no trial is set up.
        const company = await tx.company.create({
          data: {
            name: dto.companyName,
            taxId,
            regon: dto.regon || null,
            street: dto.street || null,
            city: dto.city || null,
            postalCode: dto.postalCode || null,
            country,
            costCurrency: currencyForCountry(country),
            billingEmail: dto.billingEmail || dto.email,
            phone: dto.phone || null,
            website: dto.website || null,
            subscriptionPlan: 'FREE',
            maxDispatchers: 10,
          },
        });
        // The ADMIN user
        const user = await tx.user.create({
          data: {
            companyId: company.id,
            emailEncrypted: encrypt(dto.email),
            emailHash,
            passwordHash,
            firstNameEncrypted: encrypt(dto.firstName),
            lastNameEncrypted: encrypt(dto.lastName),
            role: 'ADMIN',
            isActive: true,
          },
        });
        return { company, user };
      }));
    } catch (e) {
      // Two registrations with the same e-mail at once: the unique index decides.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw emailTaken();
      throw e;
    }

    this.logger.log(`New company registered: ${company.name}`);

    // Issue tokens
    const tokens = await this.generateTokens(user.id, company.id, 'ADMIN', dto.email);
    return { ...tokens, userId: user.id, companyId: company.id };
  }


}