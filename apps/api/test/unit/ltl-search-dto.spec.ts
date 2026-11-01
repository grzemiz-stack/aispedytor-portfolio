/**
 * LtlSearchDto through the global ValidationPipe — one detour limit.
 */
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LtlSearchDto } from '../../src/ltl-matching/dto/ltl-search.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: object) => pipe.transform(body, { type: 'body', metatype: LtlSearchDto, data: '' });

const screenBody = {
  vehicleId: 'veh-1', currentLoadMeters: 6.7, currentLoadWeight: 0,
  routeFrom: 'Poznań, PL', routeTo: 'Berlin, DE', maxDetourKm: 100,
};

describe('LtlSearchDto', () => {
  it('accepts what the screen sends', async () => {
    await expect(validate(screenBody)).resolves.toMatchObject(screenBody);
  });

  it('rejects maxDetourPercent — the hidden second limit is gone, not silently ignored', async () => {
    await expect(validate({ ...screenBody, maxDetourPercent: 15 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
