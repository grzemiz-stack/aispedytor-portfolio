/**
 * Changing one's own password — PATCH /users/me/password.
 *
 * The settings screen sends this request; the tests check the service, the
 * DTO rules and that the route exists where the screen calls it.
 */
import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AuthService, hashRefreshToken } from '../../src/auth/auth.service';
import { UsersController } from '../../src/users/users.controller';
import { ChangePasswordDto } from '../../src/users/dto/change-password.dto';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

const SECRET = 'cd'.repeat(32);
const enc = new EncryptionService({ get: () => 'ab'.repeat(32) } as any);

async function setup(over: Partial<{ isActive: boolean; companyId: string }> = {}) {
  const user = {
    id: 'u-1', companyId: 'comp-1', role: 'DISPATCHER', isActive: true,
    emailEncrypted: enc.encrypt('jan@example.net'),
    passwordHash: await bcrypt.hash('StareHaslo1', 4),
    ...over,
  };
  const prisma: any = {
    user: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === user.id && where.companyId === user.companyId && where.isActive === user.isActive ? user : null),
      update: jest.fn(async ({ data }: any) => Object.assign(user, data)),
    },
    refreshToken: { deleteMany: jest.fn(async () => ({ count: 3 })), create: jest.fn(async () => ({})) },
  };
  const config: any = { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) };
  const service = new AuthService(prisma, new JwtService({}), config, enc);
  return { service, prisma, user };
}

const errorBody = async (p: Promise<unknown>) => {
  try { await p; } catch (e: any) { return { status: e.getStatus(), body: e.getResponse() }; }
  throw new Error('expected a rejection');
};

describe('AuthService.changePassword', () => {
  it('correct current password: new hash saved, all sessions ended, new tokens for this one', async () => {
    const { service, prisma, user } = await setup();
    const r = await service.changePassword('u-1', 'comp-1', { currentPassword: 'StareHaslo1', newPassword: 'NoweHaslo22' });

    expect(await bcrypt.compare('NoweHaslo22', user.passwordHash)).toBe(true);
    expect(await bcrypt.compare('StareHaslo1', user.passwordHash)).toBe(false);
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-1' } });
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.create.mock.calls[0][0].data.tokenHash).toBe(hashRefreshToken(r.refreshToken));
    const payload: any = new JwtService({}).verify(r.accessToken, { secret: SECRET });
    expect(payload).toMatchObject({ sub: 'u-1', companyId: 'comp-1', email: 'jan@example.net' });
  });

  it('wrong current password: 400 PASSWORD_CURRENT_INVALID, nothing changed', async () => {
    const { service, prisma, user } = await setup();
    const before = user.passwordHash;
    const e = await errorBody(service.changePassword('u-1', 'comp-1', { currentPassword: 'zle', newPassword: 'NoweHaslo22' }));

    expect(e).toEqual({ status: 400, body: { statusCode: 400, code: 'PASSWORD_CURRENT_INVALID', message: 'PASSWORD_CURRENT_INVALID' } });
    expect(user.passwordHash).toBe(before);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('new password equal to the current one: 400 PASSWORD_UNCHANGED', async () => {
    const { service, prisma } = await setup();
    const e = await errorBody(service.changePassword('u-1', 'comp-1', { currentPassword: 'StareHaslo1', newPassword: 'StareHaslo1' }));

    expect(e.body).toMatchObject({ code: 'PASSWORD_UNCHANGED' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('inactive account or another company: 404, nothing changed', async () => {
    for (const over of [{ isActive: false }, { companyId: 'comp-2' }]) {
      const { service, prisma } = await setup(over);
      const e = await errorBody(service.changePassword('u-1', 'comp-1', { currentPassword: 'StareHaslo1', newPassword: 'NoweHaslo22' }));
      expect(e.status).toBe(404);
      expect(prisma.user.update).not.toHaveBeenCalled();
    }
  });
});

describe('ChangePasswordDto — the same rules as company registration', () => {
  const errors = async (body: object) =>
    (await validate(plainToInstance(ChangePasswordDto, body))).map(e => e.property);

  it('accepts 8–100 characters with the current password given', async () => {
    expect(await errors({ currentPassword: 'x', newPassword: '12345678' })).toEqual([]);
  });

  it('rejects a short or too long new password and a missing current one', async () => {
    expect(await errors({ currentPassword: 'x', newPassword: '1234567' })).toEqual(['newPassword']);
    expect(await errors({ currentPassword: 'x', newPassword: 'a'.repeat(101) })).toEqual(['newPassword']);
    expect(await errors({ currentPassword: '', newPassword: '12345678' })).toEqual(['currentPassword']);
  });
});

describe('route PATCH /users/me/password — the path the settings screen calls', () => {
  const handler = UsersController.prototype.changePassword;

  it('exists, is PATCH, sits under /users behind the JWT guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, UsersController)).toBe('users');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('me/password');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata('__guards__', UsersController)).toContain(JwtAuthGuard);
  });

  it('changes the password of the logged-in user, not one from the body', async () => {
    const auth = { changePassword: jest.fn().mockResolvedValue({}) };
    const c = new UsersController({} as any, auth as any);
    const dto = { currentPassword: 'a', newPassword: 'bbbbbbbb' };
    await c.changePassword(dto, { user: { userId: 'u-9', companyId: 'comp-9' } } as any);
    expect(auth.changePassword).toHaveBeenCalledWith('u-9', 'comp-9', dto);
  });
});
