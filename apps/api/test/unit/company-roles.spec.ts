/**
 * Roles on the company endpoints — through the REAL Nest pipeline.
 *
 * Testing `RolesGuard` on its own would not catch a missing `@UseGuards`
 * or `@Roles` on a method. So the test starts an app with the controller and
 * calls it over HTTP. Authentication: a stand-in passport strategy named `jwt`
 * (the one `JwtAuthGuard` uses) that takes the role from a request header.
 * No `@nestjs/testing` or `supertest` — no new dependencies in the lock file.
 */
import 'reflect-metadata';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as passport from 'passport';
import { Strategy } from 'passport-strategy';
import { CompaniesController } from '../../src/companies/companies.controller';
import { CompaniesService } from '../../src/companies/companies.service';

class HeaderRoleStrategy extends Strategy {
  name = 'jwt';
  authenticate(req: any) {
    const role = req.headers['x-test-role'];
    if (!role) return this.fail(401);
    this.success({ userId: 'user-1', companyId: 'comp-1', role });
  }
}

const service = {
  findOne: jest.fn().mockResolvedValue({ id: 'comp-1' }),
  update: jest.fn().mockResolvedValue({ id: 'comp-1' }),
  uploadLogo: jest.fn().mockResolvedValue({ logoBase64: 'data:image/png;base64,AA' }),
  removeLogo: jest.fn().mockResolvedValue({ logoBase64: null }),
};

@Module({
  controllers: [CompaniesController],
  providers: [{ provide: CompaniesService, useValue: service }],
})
class TestModule {}

let app: INestApplication;
let base: string;

beforeAll(async () => {
  passport.use(new HeaderRoleStrategy() as any);
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/companies`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => jest.clearAllMocks());

const call = (method: string, path: string, role?: string, body?: object) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(role && { 'x-test-role': role }) },
    ...(body && { body: JSON.stringify(body) }),
  });

const LOGO = { logoBase64: 'data:image/png;base64,AA' };

describe('company logo — ADMIN only', () => {
  it.each(['USER', 'DISPATCHER'])('PATCH /me/logo as %s → 403, service not called', async role => {
    expect((await call('PATCH', '/me/logo', role, LOGO)).status).toBe(403);
    expect(service.uploadLogo).not.toHaveBeenCalled();
  });

  it.each(['USER', 'DISPATCHER'])('DELETE /me/logo as %s → 403, service not called', async role => {
    expect((await call('DELETE', '/me/logo', role)).status).toBe(403);
    expect(service.removeLogo).not.toHaveBeenCalled();
  });

  it('PATCH /me/logo as ADMIN → 200', async () => {
    expect((await call('PATCH', '/me/logo', 'ADMIN', LOGO)).status).toBe(200);
    expect(service.uploadLogo).toHaveBeenCalledWith('comp-1', LOGO.logoBase64);
  });

  it('DELETE /me/logo as ADMIN → 200', async () => {
    expect((await call('DELETE', '/me/logo', 'ADMIN')).status).toBe(200);
    expect(service.removeLogo).toHaveBeenCalledWith('comp-1');
  });

  it('without authentication → 401', async () => {
    expect((await call('PATCH', '/me/logo', undefined, LOGO)).status).toBe(401);
  });
});

describe('company data — the rest of the endpoints keep their roles', () => {
  it('PATCH /me as USER → 403', async () => {
    expect((await call('PATCH', '/me', 'USER', { name: 'X' })).status).toBe(403);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('GET /me as USER → 200 — reading the company is for everyone in it', async () => {
    expect((await call('GET', '/me', 'USER')).status).toBe(200);
  });
});
