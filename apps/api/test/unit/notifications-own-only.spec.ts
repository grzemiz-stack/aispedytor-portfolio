/**
 * PATCH /notifications/:id/read — only the caller's own notification.
 *
 * The update must carry `userId`: an update by `id` alone would let any
 * logged-in user who knows the id of someone else's notification mark it as
 * read (IDOR). The fake Prisma filters like the database: every field in
 * `where` must match.
 */
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../../src/notifications/notifications.service';

function service() {
  const rows = [
    { id: 'mine', userId: 'u-1', isRead: false },
    { id: 'theirs', userId: 'u-2', isRead: false },
  ];
  const match = (where: any) => rows.filter(r => Object.entries(where).every(([k, v]) => (r as any)[k] === v));
  const prisma: any = {
    notification: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = match(where);
        hit.forEach(r => Object.assign(r, data));
        return { count: hit.length };
      }),
      findFirst: jest.fn(async ({ where }: any) => match(where)[0] ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find(r => r.id === where.id)!, data)),
    },
  };
  return { svc: new NotificationsService(prisma), rows, prisma };
}

describe('markRead — own notifications only', () => {
  it('someone else’s notification → 404, and it stays unread', async () => {
    const { svc, rows } = service();
    await expect(svc.markRead('theirs', 'u-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.find(r => r.id === 'theirs')!.isRead).toBe(false);
  });

  it('unknown id → the same 404 (no hint that a foreign one exists)', async () => {
    const { svc } = service();
    const foreign = await svc.markRead('theirs', 'u-1').catch(e => e.getResponse());
    const unknown = await svc.markRead('nope', 'u-1').catch(e => e.getResponse());
    expect(foreign).toEqual(unknown);
  });

  it('own notification → marked read and returned', async () => {
    const { svc, rows } = service();
    await expect(svc.markRead('mine', 'u-1')).resolves.toMatchObject({ id: 'mine', isRead: true });
    expect(rows.find(r => r.id === 'mine')!.isRead).toBe(true);
  });

  it('the write itself carries the user (one query, no check-then-write gap)', async () => {
    const { svc, prisma } = service();
    await svc.markRead('mine', 'u-1');
    expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({ id: 'mine', userId: 'u-1' });
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});
