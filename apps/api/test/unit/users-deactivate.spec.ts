/**
 * DELETE /users/:id — deactivation.
 *
 * - the response has the decrypted shape, without hashes;
 * - refresh tokens are deleted in the same (Serializable) transaction;
 * - the last active ADMIN of the company cannot be deactivated: 409
 *   LAST_ACTIVE_ADMIN, nothing changes.
 *
 * The transaction fake is a SEPARATE object (`tx`), so the test sees what ran
 * inside the transaction and what ran next to it.
 */
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from '../../src/users/users.service';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

const enc = new EncryptionService({ get: () => 'ab'.repeat(32) } as any);

function setup(opts: { role?: 'ADMIN' | 'DISPATCHER'; isActive?: boolean; activeAdmins?: number } = {}) {
  const row: any = {
    id: 'u-2', companyId: 'comp-1', role: opts.role ?? 'DISPATCHER', isActive: opts.isActive ?? true,
    emailEncrypted: enc.encrypt('anna@example.net'), emailHash: enc.hash('anna@example.net'),
    passwordHash: '$2a$12$abcdefghijklmnopqrstuv', firstNameEncrypted: enc.encrypt('Anna'),
    lastNameEncrypted: enc.encrypt('Nowak'), phoneEncrypted: null,
    lastLoginAt: null, createdAt: new Date('2026-01-01'),
  };
  const find = async ({ where }: any) => (where.id === row.id && where.companyId === row.companyId ? row : null);
  const tx: any = {
    user: {
      findFirst: jest.fn(find),
      count: jest.fn(async () => opts.activeAdmins ?? 1),
      update: jest.fn(async ({ data }: any) => ({ ...row, ...data })),
    },
    refreshToken: { deleteMany: jest.fn(async () => ({ count: 2 })) },
  };
  const prisma: any = {
    user: { findFirst: jest.fn(find), update: jest.fn(), count: jest.fn() },
    refreshToken: { deleteMany: jest.fn() },
    $transaction: jest.fn(async (fn: (t: any) => unknown) => fn(tx)),
  };
  return { service: new UsersService(prisma, enc), prisma, tx };
}

describe('UsersService.deactivate', () => {
  it('returns the decrypted user without hashes or encrypted fields', async () => {
    const { service } = setup();
    const r: any = await service.deactivate('u-2', 'comp-1');

    expect(r).toMatchObject({ id: 'u-2', email: 'anna@example.net', firstName: 'Anna', isActive: false });
    expect(Object.keys(r).filter((k) => /hash|encrypted/i.test(k))).toEqual([]);
  });

  it('deactivates and deletes all refresh tokens inside one Serializable transaction', async () => {
    const { service, prisma, tx } = setup();
    await service.deactivate('u-2', 'comp-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u-2', companyId: 'comp-1' }, data: { isActive: false } });
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-2' } });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('a user of another company → 404, nothing changed', async () => {
    const { service, prisma, tx } = setup();
    await expect(service.deactivate('u-2', 'comp-2')).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

describe('the last active ADMIN of the company', () => {
  it('→ 409 LAST_ACTIVE_ADMIN, nothing changed', async () => {
    const { service, tx } = setup({ role: 'ADMIN', activeAdmins: 1 });
    const err = await service.deactivate('u-2', 'comp-1').catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toEqual({ statusCode: 409, code: 'LAST_ACTIVE_ADMIN', message: 'LAST_ACTIVE_ADMIN' });
    expect(tx.user.count).toHaveBeenCalledWith({ where: { companyId: 'comp-1', role: 'ADMIN', isActive: true } });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('another active ADMIN exists → deactivated', async () => {
    const { service, tx } = setup({ role: 'ADMIN', activeAdmins: 2 });
    await service.deactivate('u-2', 'comp-1');
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });

  it('a DISPATCHER is deactivated without counting admins', async () => {
    const { service, tx } = setup({ role: 'DISPATCHER' });
    await service.deactivate('u-2', 'comp-1');
    expect(tx.user.count).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });

  it('an ADMIN who is already inactive is not counted as the last one', async () => {
    const { service, tx } = setup({ role: 'ADMIN', isActive: false, activeAdmins: 1 });
    await service.deactivate('u-2', 'comp-1');
    expect(tx.user.count).not.toHaveBeenCalled();
  });
});

describe('a concurrent change', () => {
  // P2034: the Serializable transaction lost to a concurrent change. Not a
  // server error — 409 with a code the client can retry on.
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock', { code, clientVersion: '5.22.0' });

  it('P2034 → 409 CONCURRENT_CHANGE_RETRY, not 500', async () => {
    const { service, prisma } = setup();
    prisma.$transaction.mockRejectedValueOnce(prismaError('P2034'));

    const err = await service.deactivate('u-2', 'comp-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toEqual({ statusCode: 409, code: 'CONCURRENT_CHANGE_RETRY', message: 'CONCURRENT_CHANGE_RETRY' });
  });

  it('another Prisma error is not turned into a retry', async () => {
    const { service, prisma } = setup();
    const other = prismaError('P2002');
    prisma.$transaction.mockRejectedValueOnce(other);

    await expect(service.deactivate('u-2', 'comp-1')).rejects.toBe(other);
  });

  it('a non-Prisma error passes through unchanged', async () => {
    const { service, prisma } = setup();
    const boom = new Error('boom');
    prisma.$transaction.mockRejectedValueOnce(boom);

    await expect(service.deactivate('u-2', 'comp-1')).rejects.toBe(boom);
  });

  it('LAST_ACTIVE_ADMIN from inside the transaction keeps its own code', async () => {
    const { service } = setup({ role: 'ADMIN', activeAdmins: 1 });
    const err = await service.deactivate('u-2', 'comp-1').catch((e) => e);
    expect(err.getResponse().code).toBe('LAST_ACTIVE_ADMIN');
  });
});
