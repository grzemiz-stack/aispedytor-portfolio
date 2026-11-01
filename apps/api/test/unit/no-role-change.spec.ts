/**
 * The role of an existing user cannot be changed through the API.
 *
 * The LAST_ACTIVE_ADMIN rule (users.service.ts deactivate) covers only
 * deactivation, because there is no role change: `role` is only in the
 * create-user DTO. Whoever adds a role change must add the same rule — this
 * test then fails as a reminder.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../../src');

function dtoFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return dtoFiles(p);
    return /\.dto\.ts$/.test(e.name) ? [p] : [];
  });
}

it('only CreateUserDto has a `role` field', () => {
  const withRole = dtoFiles(SRC)
    .filter((f) => /^\s*role\??\s*:/m.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(SRC.length + 1));
  expect(withRole).toEqual(['users/dto/create-user.dto.ts']);
});
