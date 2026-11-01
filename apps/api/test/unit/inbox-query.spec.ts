/**
 * GET /email-agent/inbox — `category` only from the EmailCategory enum or ALL.
 *
 * The DTO used to accept any string, the service put it into the Prisma
 * `where`, and an unknown enum value ended in a 500.
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { InboxQueryDto } from '../../src/email-agent/dto/inbox-query.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const check = async (query: object) => {
  try {
    await pipe.transform(query, { type: 'query', metatype: InboxQueryDto, data: '' });
    return 'ok';
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return 400;
  }
};

it.each([
  [{}, 'ok'],
  [{ category: 'OFFER' }, 'ok'],
  [{ category: 'INVOICE' }, 'ok'],
  [{ category: 'ALL' }, 'ok'],
  [{ category: 'XYZ' }, 400],
  [{ category: 'offer' }, 400],
])('category %p → %s', async (query, expected) => {
  expect(await check(query)).toBe(expected);
});
