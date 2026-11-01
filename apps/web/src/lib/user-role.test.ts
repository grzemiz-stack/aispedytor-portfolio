/**
 * The roles in the web app = the API `UserRole` enum.
 *
 * The type in `auth.store.ts` had a third role `DRIVER` that the database does
 * not know (enum: ADMIN, DISPATCHER) and the API never issues — dead code that
 * suggested a driver account. The test reads both sources directly, so a new
 * role on one side turns it red at once.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

it('the role type in the web store lists exactly the API UserRole enum', () => {
  const schema = read('../../../api/prisma/schema.prisma');
  const apiRoles = schema.match(/enum UserRole \{([^}]*)\}/)![1].trim().split(/\s+/).sort();
  const webType = read('../store/auth.store.ts').match(/role: ([^;]+);/)![1];
  const webRoles = webType.split('|').map((r) => r.trim().replace(/'/g, '')).sort();
  expect(webRoles).toEqual(apiRoles);
  expect(apiRoles).toEqual(['ADMIN', 'DISPATCHER']);
});
