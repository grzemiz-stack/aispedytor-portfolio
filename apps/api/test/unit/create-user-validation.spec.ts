/**
 * POST /users validates the request body.
 *
 * `CreateUserDto` must be a class: if it were an interface, the parameter
 * type at runtime would be `Object` and the global ValidationPipe (main.ts)
 * would let everything through. The test takes the same path as a request:
 * the parameter type from the controller metadata → ValidationPipe with the
 * settings from main.ts.
 */
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UsersController } from '../../src/users/users.controller';

// The same options as in src/main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const metatype = Reflect.getMetadata('design:paramtypes', UsersController.prototype, 'create')[0];

const OK = { email: 'jan@example.net', password: 'Haslo1234', firstName: 'Jan', lastName: 'Kowalski' };

async function check(body: object): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype, data: '' });
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as any).message;
  }
}

it('the controller parameter is a class the pipe can validate, not Object', () => {
  expect(metatype).not.toBe(Object);
});

it('accepts a valid user, with or without an allowed role', async () => {
  expect(await check(OK)).toEqual([]);
  expect(await check({ ...OK, role: 'ADMIN' })).toEqual([]);
  expect(await check({ ...OK, role: 'DISPATCHER', phone: '+48 600 100 200' })).toEqual([]);
});

it('role only from the allowed list', async () => {
  expect((await check({ ...OK, role: 'SUPERADMIN' })).join()).toMatch(/role/);
  expect((await check({ ...OK, role: 'admin' })).join()).toMatch(/role/);
});

it('rejects a bad e-mail, a short password, missing names', async () => {
  expect((await check({ ...OK, email: 'nie-email' })).join()).toMatch(/email/);
  expect((await check({ ...OK, password: '1234567' })).join()).toMatch(/password/);
  const { firstName, lastName, ...noNames } = OK;
  const msgs = (await check(noNames)).join();
  expect(msgs).toMatch(/firstName/);
  expect(msgs).toMatch(/lastName/);
});

it('rejects fields outside the DTO (whitelist) — e.g. companyId or isActive', async () => {
  expect((await check({ ...OK, companyId: 'other-company' })).join()).toMatch(/companyId should not exist/);
  expect((await check({ ...OK, isActive: false })).join()).toMatch(/isActive should not exist/);
});
