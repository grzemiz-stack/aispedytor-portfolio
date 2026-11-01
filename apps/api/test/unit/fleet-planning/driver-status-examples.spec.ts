/**
 * The example bodies of POST /api/drivers/:id/status in the module README
 * are valid and state `onDuty` explicitly (omitted means
 * unknown, and availability then takes the worst case). Swagger shows an
 * example for `onDuty` too.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { CreateDriverStatusDto } from '../../../src/fleet-planning/dto/create-driver-status.dto';
import { statusProblem } from '../../../src/fleet-planning/drivers.service';

const readme = readFileSync(resolve(__dirname, '../../../src/fleet-planning/README.md'), 'utf8');
const section = readme.slice(readme.indexOf('### The manual status'), readme.indexOf('The bounds are physical'));
const examples = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

it('the README has a resting and an on-duty example, each with onDuty', () => {
  expect(examples.map((e) => e.onDuty)).toEqual([false, true]);
});

it.each([0, 1])('example %i passes the DTO and the cross-field rules', async (i) => {
  const dto = await pipe.transform(examples[i], { type: 'body', metatype: CreateDriverStatusDto, data: '' });
  expect(statusProblem(dto)).toBeNull();
});

it('Swagger shows an example value for onDuty', () => {
  const meta = Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, CreateDriverStatusDto.prototype, 'onDuty');
  expect(meta?.example).toBe(false);
});
